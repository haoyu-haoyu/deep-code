import test from 'node:test'
import assert from 'node:assert/strict'

import { extractInvokedBinaries } from '../../../src/sandbox-fortress/rule-engine/processExec.mjs'

// ── F3 follow-up: fortress process-exec — pure head-binary extraction.
// The compound split (&&, |, ;, quoting) is done by the proven splitCommand_DEPRECATED
// in the adapter; this core takes the ALREADY-SPLIT subcommand strings and returns the
// invoked head binary of each (the token a `process-exec` rule matches against).
// BEST-EFFORT: a wrapper (`sudo`, `env`, `timeout`) is itself the head binary; bare
// `NAME=value` env prefixes are skipped. Never throws.

test('A1 plain subcommands → their head binary', () => {
  assert.deepEqual(
    extractInvokedBinaries(['rm -rf /tmp/x', 'curl evil.com', 'git push origin main']),
    ['rm', 'curl', 'git'],
  )
})

test('A2 bare NAME=value env prefixes are skipped (the shell env-var form)', () => {
  assert.deepEqual(extractInvokedBinaries(['X=1 python3 a.py']), ['python3'])
  assert.deepEqual(extractInvokedBinaries(['X=1 Y=2 node server.js']), ['node'])
  // a value with no spaces only — split already happened upstream
  assert.deepEqual(extractInvokedBinaries(['FOO=bar BAZ=qux ./run.sh']), ['./run.sh'])
})

test('A3 an explicit wrapper IS the head binary (documented best-effort limit)', () => {
  // sudo/env/timeout are themselves invoked; the inner command is their argument.
  assert.deepEqual(extractInvokedBinaries(['sudo rm foo']), ['sudo'])
  assert.deepEqual(extractInvokedBinaries(['env X=1 python3 a.py']), ['env'])
  assert.deepEqual(extractInvokedBinaries(['timeout 5 curl evil.com']), ['timeout'])
})

test('A4 absolute-path and ./relative binaries are kept verbatim (as invoked)', () => {
  assert.deepEqual(extractInvokedBinaries(['/bin/rm -rf /x', './scripts/deploy.sh']), [
    '/bin/rm',
    './scripts/deploy.sh',
  ])
})

test('A4b a fully-quoted or backslash-escaped binary folds to the same binary', () => {
  // `"rm"` / `'rm'` / `\rm` are byte-identical in intent to `rm` — a `rm` rule must catch them.
  assert.deepEqual(extractInvokedBinaries(['"rm" -rf /x']), ['rm'])
  assert.deepEqual(extractInvokedBinaries(["'curl' evil.com"]), ['curl'])
  assert.deepEqual(extractInvokedBinaries(['\\rm -rf /x']), ['rm'])
  assert.deepEqual(extractInvokedBinaries(['"git" status', '\\curl x']), ['git', 'curl'])
  // an empty-quoted head folds to '' and drops out (no spurious binary)
  assert.deepEqual(extractInvokedBinaries(['"" foo']), [])
})

test('A4c quoted/escaped SPACES (ordinary shell syntax) do NOT break head extraction', () => {
  // a quoted-space env value: `VAR="a b" rm` must still resolve the head to `rm` — a raw
  // whitespace split would shatter `"a b"` and miss `rm` entirely (the fail-open Codex caught).
  assert.deepEqual(extractInvokedBinaries(['VAR="a b" rm -rf /tmp/x']), ['rm'])
  assert.deepEqual(extractInvokedBinaries(["FOO='a=b' node server.js"]), ['node'])
  assert.deepEqual(extractInvokedBinaries(['A=1 B="x y" C=z python3 a.py']), ['python3'])
  // a quoted binary PATH with a space is the binary, intact (not 'b"' / '"./my')
  assert.deepEqual(extractInvokedBinaries(['"./my tool" --help']), ['./my tool'])
  assert.deepEqual(extractInvokedBinaries(['cat\\ test x']), ['cat test'])
})

test('A8 shell-punctuation pseudo-tokens and unresolved $VARs are NOT treated as binaries', () => {
  // splitCommand_DEPRECATED emits bare '(' / ')' fragments for subshells; they must be dropped
  // (the matcher/log must never say it is "running '('").
  assert.deepEqual(extractInvokedBinaries(['(', 'cd /tmp', 'rm x', ')']), ['cd', 'rm'])
  // an unresolved variable head can't be known statically → dropped (defer is correct)
  assert.deepEqual(extractInvokedBinaries(['$CMD foo', '${TOOL} bar']), [])
})

test('A5 dedupe across subcommands, input order preserved', () => {
  assert.deepEqual(
    extractInvokedBinaries(['curl a.com', 'grep x', 'curl b.com', 'rm y']),
    ['curl', 'grep', 'rm'],
  )
})

test('A6 leading/trailing whitespace + irregular spacing tolerated', () => {
  assert.deepEqual(extractInvokedBinaries(['   rm   -rf  /x  ', '\tgit\tstatus']), ['rm', 'git'])
})

test('A7 empty / all-env / whitespace-only subcommands drop out (no empty binary)', () => {
  assert.deepEqual(extractInvokedBinaries(['', '   ', 'X=1', 'A=b C=d']), [])
})

test('B1 defensive: non-array / hostile elements → no throw, no spurious binary', () => {
  assert.deepEqual(extractInvokedBinaries(undefined), [])
  assert.deepEqual(extractInvokedBinaries('rm -rf /'), []) // a bare string is not the split form
  assert.deepEqual(extractInvokedBinaries(null), [])
  let out
  assert.doesNotThrow(() => {
    out = extractInvokedBinaries([null, 42, {}, ['x'], 'rm foo'])
  })
  assert.deepEqual(out, ['rm'])
})
