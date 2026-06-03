import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SAFE_ENV_VARS,
  ANT_ONLY_SAFE_ENV_VARS,
  BINARY_HIJACK_VARS,
  stripCommentLines,
  stripSafeWrappers,
  stripAllLeadingEnvVars,
  stripEnvCommandPrefix,
} from '../src/tools/BashTool/commandStripping.mjs'

// ── bash command-stripping (deny-bypass prevention) ─────────────────────────
// SECURITY-critical: these functions decide the "real" command that permission /
// deny rules match against. A stripping bug is a deny-rule bypass. This logic
// was previously trapped in bashPermissions.ts (imports bun:bundle, not
// node-testable) with NO unit coverage; here it is exercised against adversarial
// bypass inputs. (Behavior is a verbatim extraction — no logic change.)

function withUserType(value, fn) {
  const prev = process.env.USER_TYPE
  if (value === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = prev
  }
}

// --- stripSafeWrappers: env vars (ALLOW-rule semantics — safe-list only) -----

test('stripSafeWrappers: a SAFE env var is stripped; a non-safe one is NOT', () => {
  assert.equal(stripSafeWrappers('TZ=UTC echo hi'), 'echo hi')
  assert.equal(stripSafeWrappers('NODE_ENV=production npm test'), 'npm test')
  // FOO is not in the safe-list → must remain so `Bash(echo:*)` does not match.
  assert.equal(stripSafeWrappers('FOO=bar echo hi'), 'FOO=bar echo hi')
})

test('stripSafeWrappers: execution/library-loading env vars are NEVER stripped', () => {
  for (const cmd of [
    'LD_PRELOAD=/evil.so curl x',
    'LD_LIBRARY_PATH=/evil curl x',
    'DYLD_INSERT_LIBRARIES=/evil curl x',
    'PATH=/evil:/bin ls',
    'NODE_OPTIONS=--require=/evil node app',
    'PYTHONPATH=/evil python s',
    'BASH_ENV=/evil bash s',
  ]) {
    assert.equal(stripSafeWrappers(cmd), cmd, `must not strip: ${cmd}`)
  }
})

test('stripSafeWrappers: an unsafe value (injection chars) blocks even a safe var', () => {
  // TZ is safe, but the value pattern only allows [A-Za-z0-9_./:-]; a ';' (command
  // separator) is not matched, so the prefix is NOT stripped.
  assert.equal(stripSafeWrappers('TZ=a;rm -rf / echo hi'), 'TZ=a;rm -rf / echo hi')
})

test('stripSafeWrappers: never strips across a newline (\\n is a command separator)', () => {
  // TZ=UTC alone on line 1, a different command on line 2: must NOT strip the
  // assignment and run line 2 as the "real" command.
  assert.equal(stripSafeWrappers('TZ=UTC\necho evil'), 'TZ=UTC\necho evil')
})

test('stripSafeWrappers: ANT-only env vars strip ONLY for ant users', () => {
  withUserType(undefined, () => {
    assert.equal(stripSafeWrappers('DOCKER_HOST=tcp://evil docker ps'), 'DOCKER_HOST=tcp://evil docker ps')
  })
  withUserType('ant', () => {
    assert.equal(stripSafeWrappers('DOCKER_HOST=tcp://evil docker ps'), 'docker ps')
  })
})

// --- stripSafeWrappers: command wrappers -------------------------------------

test('stripSafeWrappers: timeout / time / nice / nohup / stdbuf are stripped', () => {
  assert.equal(stripSafeWrappers('timeout 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('timeout -k 5 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('timeout --signal=TERM 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('time ls'), 'ls')
  assert.equal(stripSafeWrappers('nice rm -rf /tmp/x'), 'rm -rf /tmp/x') // bare nice
  assert.equal(stripSafeWrappers('nice -n 5 rm x'), 'rm x')
  assert.equal(stripSafeWrappers('nice -5 rm x'), 'rm x') // legacy -N
  assert.equal(stripSafeWrappers('nohup curl x'), 'curl x')
  assert.equal(stripSafeWrappers('stdbuf -o0 cmd x'), 'cmd x')
})

test('stripSafeWrappers: timeout flag-VALUE injection is NOT stripped (security regression guard)', () => {
  // `timeout -k$(id) 10 ls` — the flag value $(id) is not in the allowlist, so
  // the whole timeout wrapper does NOT match → not stripped to `ls` (bash would
  // expand $(id) during word splitting BEFORE timeout runs).
  const out = stripSafeWrappers('timeout -k$(id) 10 ls')
  assert.notEqual(out, 'ls')
  assert.match(out, /timeout/)
})

test('stripSafeWrappers: a wrapper consumes its own `--` (no `--` baseCmd bypass)', () => {
  // nohup -- rm -- -/../foo → rm -- -/../foo (NOT `-- rm ...` which would make
  // `--` the baseCmd and skip path validation).
  assert.equal(stripSafeWrappers('nohup -- rm -- -/../foo'), 'rm -- -/../foo')
})

test('stripSafeWrappers: env vars after a wrapper are NOT stripped (HackerOne #3543050)', () => {
  // After a wrapper, VAR=val is the COMMAND argv (execvp), not a shell
  // assignment — phase 2 must not strip it.
  assert.equal(stripSafeWrappers('timeout 10 TZ=UTC echo hi'), 'TZ=UTC echo hi')
})

test('stripSafeWrappers: full-line comments are stripped', () => {
  assert.equal(stripSafeWrappers('# explain\nls /tmp'), 'ls /tmp')
})

// --- stripAllLeadingEnvVars: deny-rule matching (broader, must be hard to bypass)

test('stripAllLeadingEnvVars: strips ARBITRARY leading env vars (deny must stay blocked)', () => {
  assert.equal(stripAllLeadingEnvVars('FOO=bar claude'), 'claude')
  assert.equal(stripAllLeadingEnvVars('A=1 B=2 rm -rf /'), 'rm -rf /')
})

test('stripAllLeadingEnvVars: the FOO=a=b bypass is closed (= in value is matched)', () => {
  assert.equal(stripAllLeadingEnvVars('FOO=a=b denied_command'), 'denied_command')
})

test('stripAllLeadingEnvVars: quoted values strip; injection ($/backtick/;) does NOT', () => {
  assert.equal(stripAllLeadingEnvVars("FOO='a b c' cmd"), 'cmd')
  assert.equal(stripAllLeadingEnvVars('FOO="a b c" cmd'), 'cmd')
  // $(...) / ${...} must block stripping (would otherwise hide a substitution).
  assert.equal(stripAllLeadingEnvVars('FOO=$(evil) cmd'), 'FOO=$(evil) cmd')
  assert.equal(stripAllLeadingEnvVars('FOO=a;rm cmd'), 'FOO=a;rm cmd')
})

test('stripAllLeadingEnvVars: BINARY_HIJACK_VARS blocklist stops stripping a hijack var', () => {
  // Without a blocklist (deny rules): strip everything.
  assert.equal(stripAllLeadingEnvVars('LD_PRELOAD=/evil.so cmd'), 'cmd')
  // With BINARY_HIJACK_VARS (excludedCommands): a hijack var is NOT stripped and
  // stripping stops there, so the command stays "dangerous-looking".
  assert.equal(stripAllLeadingEnvVars('LD_PRELOAD=/evil.so cmd', BINARY_HIJACK_VARS), 'LD_PRELOAD=/evil.so cmd')
  assert.equal(stripAllLeadingEnvVars('PATH=/evil cmd', BINARY_HIJACK_VARS), 'PATH=/evil cmd')
  // A non-hijack var before a hijack var: stripping stops at the hijack var.
  assert.equal(stripAllLeadingEnvVars('FOO=bar LD_PRELOAD=/evil cmd', BINARY_HIJACK_VARS), 'LD_PRELOAD=/evil cmd')
})

// --- BINARY_HIJACK_VARS regex -----------------------------------------------

test('BINARY_HIJACK_VARS matches LD_*/DYLD_*/exact-PATH, not innocent names', () => {
  for (const v of ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'PATH']) {
    assert.ok(BINARY_HIJACK_VARS.test(v), `should flag ${v}`)
  }
  for (const v of ['PATHEXT', 'MYPATH', 'FOO', 'NODE_ENV']) {
    assert.ok(!BINARY_HIJACK_VARS.test(v), `should NOT flag ${v}`)
  }
})

// --- stripCommentLines -------------------------------------------------------

test('stripCommentLines: drops full-line comments, keeps inline, preserves all-comment input', () => {
  assert.equal(stripCommentLines('# c1\nls\n# c2'), 'ls')
  assert.equal(stripCommentLines('ls # inline kept'), 'ls # inline kept')
  assert.equal(stripCommentLines('# only\n# comments'), '# only\n# comments') // all comments → original
})

// --- stdbuf long-form / space-separated flags (deny-bypass regression) -------

test('stripSafeWrappers: stdbuf strips fused / space-separated / long-form / bare', () => {
  assert.equal(stripSafeWrappers('stdbuf -o0 curl x'), 'curl x') // fused (pre-existing)
  assert.equal(stripSafeWrappers('stdbuf -o 0 curl x'), 'curl x') // space-separated
  assert.equal(stripSafeWrappers('stdbuf --output=0 curl x'), 'curl x') // long-form
  assert.equal(stripSafeWrappers('stdbuf -i L -o 4096 -eL curl x'), 'curl x') // mixed
  // SECURITY: bare `stdbuf <cmd>` (no flag) still execs the cmd → must strip so a
  // denied command run as `stdbuf <denied>` reduces to <denied>.
  assert.equal(stripSafeWrappers('stdbuf curl x'), 'curl x')
})

test('stripSafeWrappers: stdbuf flag-VALUE injection / unknown flag is NOT stripped', () => {
  // $(...) in a flag value must block stripping (bash expands it pre-stdbuf),
  // same guard as the timeout pattern.
  const out = stripSafeWrappers('stdbuf -o$(id) curl x')
  assert.notEqual(out, 'curl x')
  assert.match(out, /stdbuf/)
  // `stdbuf` directly before a dash flag it doesn't recognize → not stripped.
  assert.match(stripSafeWrappers('stdbuf --bogus curl x'), /stdbuf/)
})

test('stripSafeWrappers: bare stdbuf does NOT expose a substitution/operator (no over-strip)', () => {
  // SECURITY: the bare-stdbuf pattern strips only an injection-safe command start
  // [A-Za-z0-9_]; a leading shell substitution/operator after `stdbuf ` must NOT
  // be exposed (bash expands $()/`` during word-splitting before stdbuf runs).
  for (const cmd of ['stdbuf $(id) curl', 'stdbuf `whoami` cat', 'stdbuf ;rm -rf /', 'stdbuf |evil', 'stdbuf &bg']) {
    assert.equal(stripSafeWrappers(cmd), cmd, `must not strip/expose: ${cmd}`)
  }
})

test('stripSafeWrappers: benign scheduler wrappers strip; dangerous/injection do NOT', () => {
  // setsid / ionice / chrt / taskset are transparent → strip to expose the cmd
  assert.equal(stripSafeWrappers('setsid curl x'), 'curl x')
  assert.equal(stripSafeWrappers('ionice -c2 curl x'), 'curl x')
  assert.equal(stripSafeWrappers('ionice -c 2 -n 0 curl x'), 'curl x')
  assert.equal(stripSafeWrappers('chrt 50 curl x'), 'curl x')
  assert.equal(stripSafeWrappers('chrt -f 50 curl x'), 'curl x')
  assert.equal(stripSafeWrappers('taskset 0x3 curl x'), 'curl x')
  assert.equal(stripSafeWrappers('taskset -c 0,1 curl x'), 'curl x')
  // SECURITY: privilege/exec wrappers must NOT be stripped (would let a deny on
  // the inner command be evaded AND, worse, an allow rule auto-approve `sudo rm`)
  for (const cmd of ['sudo curl x', 'doas curl x', 'gdb curl x', 'strace curl x', 'systemd-run curl x', 'proxychains curl x']) {
    assert.match(stripSafeWrappers(cmd), new RegExp('^' + cmd.split(' ')[0]), `must not strip: ${cmd}`)
  }
  // injection / pid-mode / missing-arg → fail closed (not stripped)
  for (const cmd of ['setsid $(id) rm', 'ionice -c $(id) rm', 'ionice -p 1234', 'chrt -p 50 1234', 'chrt rm', 'taskset $(id) rm']) {
    assert.equal(stripSafeWrappers(cmd), cmd, `must not strip/expose: ${cmd}`)
  }
})

// --- stripEnvCommandPrefix: the `env <denied>` deny-bypass fix ----------------

test('stripEnvCommandPrefix: strips a leading env wrapper + its safe flags', () => {
  assert.equal(stripEnvCommandPrefix('env curl http://evil.com'), 'curl http://evil.com')
  assert.equal(stripEnvCommandPrefix('env -i curl x'), 'curl x')
  assert.equal(stripEnvCommandPrefix('env -i -v curl x'), 'curl x')
  assert.equal(stripEnvCommandPrefix('env -u PATH curl x'), 'curl x')
  assert.equal(stripEnvCommandPrefix('env -i -u PATH curl x'), 'curl x')
})

test('stripEnvCommandPrefix: leaves VAR=val for the loop\'s stripAllLeadingEnvVars', () => {
  // env only peels the `env` token + dash-flags; the VAR=val stays so the deny
  // loop's stripAllLeadingEnvVars removes it on the next iteration.
  assert.equal(stripEnvCommandPrefix('env FOO=bar curl x'), 'FOO=bar curl x')
  assert.equal(stripEnvCommandPrefix('env LD_PRELOAD=/evil.so curl x'), 'LD_PRELOAD=/evil.so curl x')
  assert.equal(stripEnvCommandPrefix('env -i FOO=bar curl x'), 'FOO=bar curl x')
})

test('stripEnvCommandPrefix: fails closed on -S/-C/-P/-- and unknown flags', () => {
  // skipEnvFlags returns -1 for these (argv splitter / altwd / altpath); the
  // string mirror must leave the command UNCHANGED rather than guess.
  for (const cmd of [
    'env -S "a b" curl x',
    'env -C /tmp curl x',
    'env -P /bin curl x',
    'env -- curl x',
    'env --ignore-environment curl x', // long form not in skipEnvFlags either
  ]) {
    assert.equal(stripEnvCommandPrefix(cmd), cmd, `must not strip: ${cmd}`)
  }
})

test('stripEnvCommandPrefix: no-op when there is no env prefix', () => {
  assert.equal(stripEnvCommandPrefix('curl x'), 'curl x')
  assert.equal(stripEnvCommandPrefix('environment-setup x'), 'environment-setup x') // word boundary
  assert.equal(stripEnvCommandPrefix('env=foo curl'), 'env=foo curl') // assignment to a var named env
  assert.equal(stripEnvCommandPrefix('env'), 'env') // bare env, no wrapped command
  assert.equal(stripEnvCommandPrefix('env -i'), 'env -i') // flags but no command
})

test('stripEnvCommandPrefix: never strips across a newline', () => {
  assert.equal(stripEnvCommandPrefix('env\ncurl evil'), 'env\ncurl evil')
})

// --- deny-candidate CLOSURE regression (mirrors filterRulesByContentsMatchingInput)
//
// The deny matcher generates candidates by applying stripAllLeadingEnvVars +
// stripSafeWrappers + stripEnvCommandPrefix to a fixed-point (bashPermissions.ts).
// A `Bash(<cmd>:*)` prefix deny matches a candidate iff candidate === <cmd> or
// startsWith(<cmd> + ' '). This pins the property the wiring relies on, using the
// REAL strippers: a denied command run via `env`/`stdbuf` MUST still reduce to a
// matching candidate, while the ALLOW-side closure (no env stripping) must NOT.
function denyCandidates(command) {
  const out = [command]
  const seen = new Set(out)
  for (let i = 0; i < out.length; i++) {
    for (const next of [
      stripAllLeadingEnvVars(out[i]),
      stripSafeWrappers(out[i]),
      stripEnvCommandPrefix(out[i]),
    ]) {
      if (!seen.has(next)) {
        seen.add(next)
        out.push(next)
      }
    }
  }
  return out
}
const denyMatches = (command, prefix) =>
  denyCandidates(command).some(c => c === prefix || c.startsWith(prefix + ' '))
// ALLOW closure: stripSafeWrappers only (no env / no broad env-var strip).
const allowMatches = (command, prefix) => {
  const s = stripSafeWrappers(command)
  return [command, s].some(c => c === prefix || c.startsWith(prefix + ' '))
}

test('deny closure: `env <denied>` (and stdbuf/nohup combos) reduce to a deny match', () => {
  for (const command of [
    'env curl http://evil.com',
    'env FOO=bar curl http://evil.com',
    'env -i curl http://evil.com',
    'env -u PATH curl http://evil.com',
    'env LD_PRELOAD=/evil.so curl http://evil.com',
    'nohup env curl http://evil.com',
    'stdbuf -o0 env curl http://evil.com',
    'stdbuf --output=0 curl http://evil.com',
    'stdbuf curl http://evil.com', // bare stdbuf (no flag) — the path/deny bypass fix
    'setsid curl http://evil.com', // benign scheduler wrappers
    'ionice -c2 curl http://evil.com',
    'chrt 50 curl http://evil.com',
    'taskset 0x3 curl http://evil.com',
    'timeout 5 curl http://evil.com',
  ]) {
    assert.ok(denyMatches(command, 'curl'), `deny should match: ${command}`)
  }
  // cross-command sanity
  assert.ok(denyMatches('env rm -rf /important', 'rm'))
  assert.ok(denyMatches('env git push --force', 'git push'))
})

test('allow closure: `env <cmd>` must NOT auto-match an allow rule (env can set LD_PRELOAD)', () => {
  // The whole reason env stripping is deny-only: an allow rule must not be
  // satisfied by `env LD_PRELOAD=/evil.so curl`.
  assert.ok(allowMatches('curl http://ok.com', 'curl'), 'plain curl still allowed')
  assert.ok(allowMatches('timeout 5 curl http://ok.com', 'curl'), 'safe wrapper still allowed')
  assert.ok(!allowMatches('env curl http://evil.com', 'curl'), 'env must not auto-allow')
  assert.ok(!allowMatches('env LD_PRELOAD=/evil.so curl http://evil.com', 'curl'), 'hijack must not auto-allow')
})

// --- the constants are the documented safe-lists (regression guard) ----------

test('SAFE_ENV_VARS excludes every execution/loading var; ANT-only has DOCKER_HOST/KUBECONFIG', () => {
  for (const forbidden of ['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'PYTHONPATH', 'BASH_ENV', 'HOME', 'SHELL']) {
    assert.ok(!SAFE_ENV_VARS.has(forbidden), `${forbidden} must NEVER be safe-listed`)
  }
  assert.ok(SAFE_ENV_VARS.has('TZ') && SAFE_ENV_VARS.has('NODE_ENV'))
  assert.ok(ANT_ONLY_SAFE_ENV_VARS.has('DOCKER_HOST') && ANT_ONLY_SAFE_ENV_VARS.has('KUBECONFIG'))
})
