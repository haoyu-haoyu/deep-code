import test from 'node:test'
import assert from 'node:assert/strict'

import {
  skipTimeoutFlags,
  skipStdbufFlags,
  skipEnvFlags,
  skipIoniceFlags,
  skipChrtFlags,
  skipTasksetFlags,
  stripWrappersFromArgv,
} from '../src/tools/BashTool/argvWrapperStripping.mjs'

// ── argv-level wrapper stripping (path-validation base-command resolution) ────
// stripWrappersFromArgv decides the BASE COMMAND that PATH validation sees
// (validateSinglePathCommandArgv). If a path command (cat/cp/rm/…) hides behind
// timeout/nice/stdbuf/env/time/nohup and the wrapper isn't peeled, baseCmd would
// be the wrapper → "not path-restricted" → out-of-project paths NEVER validated.
// Conversely it must FAIL CLOSED (return argv UNCHANGED → baseCmd=wrapper →
// passthrough, backstopped by checkSemantics which fails closed first) on
// unparseable flags rather than guessing. This logic had ZERO unit coverage
// (trapped in a .ts that imports shell-quote/tree-sitter). Verbatim extraction.

const C = ['cat', '/etc/passwd'] // a path command + an out-of-project path

// --- the core security property: a path command is EXPOSED for validation -----

test('strips each safe wrapper so the real path command becomes baseCmd', () => {
  assert.deepEqual(stripWrappersFromArgv(['cat', 'f']), ['cat', 'f']) // no wrapper
  assert.deepEqual(stripWrappersFromArgv(['timeout', '5', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '5s', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '-k', '5', '10', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '-k5', '10', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '--signal=TERM', '10', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '--kill-after', '5', '10', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['time', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['nohup', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['nice', ...C]), C) // bare nice
  assert.deepEqual(stripWrappersFromArgv(['nice', '-n', '5', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['nice', '-5', ...C]), C) // legacy -N
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', ...C]), C) // bare stdbuf (no flag) — still execs the cmd
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', '-o0', ...C]), C) // fused
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', '-o', '0', ...C]), C) // space-sep
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', '--output=0', ...C]), C) // long
  assert.deepEqual(stripWrappersFromArgv(['env', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['env', 'FOO=bar', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['env', '-i', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['env', '-u', 'PATH', ...C]), C)
})

test('SECURITY: zero-flag `stdbuf <path-cmd>` exposes the real command for validation', () => {
  // Regression for the path-validation bypass: `stdbuf cat /etc/passwd` (no
  // stdbuf flag) must resolve to baseCmd 'cat' (→ path-validated), NOT 'stdbuf'
  // (→ passthrough → out-of-project paths never validated). stdbuf with no flag
  // is NOT inert — it still execs the wrapped command.
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', 'cat', '/etc/passwd']), ['cat', '/etc/passwd'])
  assert.deepEqual(stripWrappersFromArgv(['stdbuf', 'rm', '-rf', '/etc/x']), ['rm', '-rf', '/etc/x'])
  assert.deepEqual(stripWrappersFromArgv(['timeout', '5', 'stdbuf', 'cat', '/etc/x']), ['cat', '/etc/x']) // nested
  // stdbuf ALONE (no wrapped command) stays inert.
  assert.deepEqual(stripWrappersFromArgv(['stdbuf']), ['stdbuf'])
})

test('strips NESTED wrappers down to the real path command (fixed point)', () => {
  assert.deepEqual(stripWrappersFromArgv(['nice', 'timeout', '5', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['nohup', 'nice', '-n', '5', 'stdbuf', '-o0', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['timeout', '5', 'env', 'FOO=bar', ...C]), C)
})

test('SECURITY: benign scheduler wrappers (setsid/ionice/chrt/taskset) expose the wrapped command', () => {
  const C = ['rm', '-rf', '/etc/x']
  // transparent wrappers → strip to the real path command (so it gets validated)
  assert.deepEqual(stripWrappersFromArgv(['setsid', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['setsid', '-f', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['ionice', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['ionice', '-c2', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['ionice', '-c', '2', '-n', '0', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['chrt', '50', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['chrt', '-f', '50', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['taskset', '0x3', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['taskset', '-c', '0,1', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['setsid', 'ionice', '-c2', 'chrt', '20', ...C]), C) // nested
})

test('SECURITY: dangerous / pid-mode / unparseable wrappers are NOT stripped (fail closed)', () => {
  // privilege/exec wrappers must NOT be transparently stripped — `sudo rm` must
  // not reduce to `rm` (that would auto-approve a root delete under Bash(rm:*)).
  for (const w of ['sudo', 'doas', 'su', 'gdb', 'strace', 'systemd-run', 'proxychains']) {
    assert.deepEqual(stripWrappersFromArgv([w, 'rm', '/etc/x']), [w, 'rm', '/etc/x'])
  }
  // pid-modes operate on an existing process (no wrapped command) → leave intact
  assert.deepEqual(stripWrappersFromArgv(['ionice', '-p', '1234']), ['ionice', '-p', '1234'])
  assert.deepEqual(stripWrappersFromArgv(['chrt', '-p', '50', '1234']), ['chrt', '-p', '50', '1234'])
  assert.deepEqual(stripWrappersFromArgv(['taskset', '-p', '0x3', '1234']), ['taskset', '-p', '0x3', '1234'])
  // chrt requires a numeric priority; unknown flag; unsafe ionice value → fail closed
  assert.deepEqual(stripWrappersFromArgv(['chrt', 'rm', '/x']), ['chrt', 'rm', '/x'])
  assert.deepEqual(stripWrappersFromArgv(['setsid', '--bogus', 'rm']), ['setsid', '--bogus', 'rm'])
  assert.deepEqual(stripWrappersFromArgv(['ionice', '-c', '$(id)', 'rm']), ['ionice', '-c', '$(id)', 'rm'])
  // SECURITY: an EXPANSION in the wrapped-command position must NOT be exposed as
  // baseCmd (mirrors the nice fail-closed) — across all 4 benign wrappers.
  assert.deepEqual(stripWrappersFromArgv(['setsid', '$(id)', 'curl']), ['setsid', '$(id)', 'curl'])
  assert.deepEqual(stripWrappersFromArgv(['ionice', '$(id)', 'curl']), ['ionice', '$(id)', 'curl'])
  assert.deepEqual(stripWrappersFromArgv(['chrt', '50', '$(id)']), ['chrt', '50', '$(id)'])
  assert.deepEqual(stripWrappersFromArgv(['taskset', '0x3', '`id`']), ['taskset', '0x3', '`id`'])
  // a plain absolute path is fine (not an expansion) — still strips
  assert.deepEqual(stripWrappersFromArgv(['setsid', '/bin/rm', '/x']), ['/bin/rm', '/x'])
})

test('skip{Ionice,Chrt,Taskset}Flags: command index, -1 on pid-mode / missing arg', () => {
  assert.equal(skipIoniceFlags(['ionice', 'cat']), 1)
  assert.equal(skipIoniceFlags(['ionice', '-c2', 'cat']), 2)
  assert.equal(skipIoniceFlags(['ionice', '-p', '1234']), -1)
  assert.equal(skipChrtFlags(['chrt', '50', 'cat']), 2)
  assert.equal(skipChrtFlags(['chrt', '-f', '50', 'cat']), 3)
  assert.equal(skipChrtFlags(['chrt', 'cat']), -1) // no priority
  assert.equal(skipChrtFlags(['chrt', '-p', '1234']), -1)
  assert.equal(skipTasksetFlags(['taskset', '0x3', 'cat']), 2)
  assert.equal(skipTasksetFlags(['taskset', '-c', '0,1', 'cat']), 3)
  assert.equal(skipTasksetFlags(['taskset', '-p', '0x3', '1234']), -1)
})

test("consumes a wrapper's own -- end-of-options marker", () => {
  // `nohup -- cat f` → cat f (not `-- cat f` which would make `--` the baseCmd).
  assert.deepEqual(stripWrappersFromArgv(['nohup', '--', ...C]), C)
  assert.deepEqual(stripWrappersFromArgv(['nice', '--', ...C]), C)
})

// --- FAIL CLOSED: unparseable → return UNCHANGED (baseCmd=wrapper→passthrough) -

test('fails closed (returns argv unchanged) on unparseable wrapper flags', () => {
  // timeout flag-value injection: `-k$(id)` is not in the value allowlist.
  const inj = ['timeout', '-k$(id)', '10', 'cat', 'f']
  assert.deepEqual(stripWrappersFromArgv(inj), inj) // unchanged → baseCmd 'timeout'
  // timeout with an unrecognized long flag.
  const badLong = ['timeout', '--bogus', '10', 'cat', 'f']
  assert.deepEqual(stripWrappersFromArgv(badLong), badLong)
  // timeout with a non-numeric "duration".
  const badDur = ['timeout', 'abc', 'cat', 'f']
  assert.deepEqual(stripWrappersFromArgv(badDur), badDur)
  // stdbuf unknown flag.
  const badStdbuf = ['stdbuf', '--bogus', 'cat', 'f']
  assert.deepEqual(stripWrappersFromArgv(badStdbuf), badStdbuf)
  // env rejects -S (argv splitter), -C/-P (altwd/altpath).
  for (const flag of ['-S', '-C', '-P']) {
    const e = ['env', flag, 'x', 'cat', 'f']
    assert.deepEqual(stripWrappersFromArgv(e), e)
  }
})

// --- skip* helpers directly (return the argv index of the wrapped command) ----

test('skipTimeoutFlags: index of the DURATION token, -1 if unparseable', () => {
  assert.equal(skipTimeoutFlags(['timeout', '5', 'cat']), 1)
  assert.equal(skipTimeoutFlags(['timeout', '-k', '5', '10', 'cat']), 3)
  assert.equal(skipTimeoutFlags(['timeout', '--signal=TERM', '10', 'cat']), 2)
  assert.equal(skipTimeoutFlags(['timeout', '-k$(id)', '10']), -1) // injection → fail closed
  assert.equal(skipTimeoutFlags(['timeout', '--bogus']), -1)
})

test('skipStdbufFlags: index of wrapped command, -1 if no flags / unknown flag', () => {
  assert.equal(skipStdbufFlags(['stdbuf', '-o0', 'cat']), 2)
  assert.equal(skipStdbufFlags(['stdbuf', '-o', '0', 'cat']), 3)
  assert.equal(skipStdbufFlags(['stdbuf', '--output=0', 'cat']), 2)
  assert.equal(skipStdbufFlags(['stdbuf', 'cat']), 1) // SECURITY: zero-flag stdbuf still execs cat → strip it (was -1, the bypass)
  assert.equal(skipStdbufFlags(['stdbuf']), -1) // stdbuf alone — no wrapped cmd
  assert.equal(skipStdbufFlags(['stdbuf', '--bogus', 'cat']), -1)
})

test('skipEnvFlags: VAR=val + -i/-0/-v/-u NAME, -1 on -S/-C/-P/unknown or no cmd', () => {
  assert.equal(skipEnvFlags(['env', 'FOO=bar', 'cat']), 2)
  assert.equal(skipEnvFlags(['env', '-i', 'cat']), 2)
  assert.equal(skipEnvFlags(['env', '-u', 'PATH', 'cat']), 3)
  assert.equal(skipEnvFlags(['env', '-i', 'FOO=bar', 'cat']), 3)
  assert.equal(skipEnvFlags(['env', '-S', 'x', 'cat']), -1) // argv splitter → fail closed
  assert.equal(skipEnvFlags(['env', '-i']), -1) // no wrapped command
})
