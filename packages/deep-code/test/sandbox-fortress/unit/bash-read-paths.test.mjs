import test from 'node:test'
import assert from 'node:assert/strict'

import { extractBashReadPaths, READER_BINARIES } from '../../../src/sandbox-fortress/rule-engine/bashReadPaths.mjs'

// ── F3 paranoid fs-read floor: pure extraction of literal read-path args from reader
// commands (the already-split subcommand strings). BEST-EFFORT — see bashReadPaths.mjs.

test('A1 a reader command exposes its non-flag args as read paths', () => {
  assert.deepEqual(extractBashReadPaths(['cat /etc/passwd']), ['/etc/passwd'])
  assert.deepEqual(extractBashReadPaths(['head ~/.ssh/id_rsa']), ['~/.ssh/id_rsa'])
  assert.deepEqual(extractBashReadPaths(['ls ~/.aws']), ['~/.aws'])
})

test('A2 flags are skipped; a non-path arg (grep pattern) is kept (caller resolves it harmlessly)', () => {
  // -r is a flag; 'secret' is the pattern (resolves to cwd → workspace → allowed by the caller);
  // '~/.aws' is the real read target.
  assert.deepEqual(extractBashReadPaths(['grep -r secret ~/.aws']), ['secret', '~/.aws'])
  // -n 5: -n is a flag, 5 is its value (kept, resolves harmlessly), file is the target
  assert.deepEqual(extractBashReadPaths(['head -n 5 /etc/hosts']), ['5', '/etc/hosts'])
})

test('A3 head binary matched by BASENAME (/bin/cat, ./cat, "cat")', () => {
  assert.deepEqual(extractBashReadPaths(['/bin/cat /etc/passwd']), ['/etc/passwd'])
  assert.deepEqual(extractBashReadPaths(['"cat" /etc/passwd']), ['/etc/passwd'])
  assert.deepEqual(extractBashReadPaths(['./cat /etc/passwd']), ['/etc/passwd'])
})

test('A4 leading NAME=value env assignments are skipped to reach the reader head', () => {
  assert.deepEqual(extractBashReadPaths(['LC_ALL=C cat /etc/x']), ['/etc/x'])
  assert.deepEqual(extractBashReadPaths(['A=1 B=2 grep foo /var/log/sys']), ['foo', '/var/log/sys'])
})

test('A5 a NON-reader command exposes no read paths (no false positive on echo/mkdir/rm)', () => {
  assert.deepEqual(extractBashReadPaths(['echo ~/.aws/credentials']), [])
  assert.deepEqual(extractBashReadPaths(['mkdir /etc/foo']), [])
  assert.deepEqual(extractBashReadPaths(['rm -rf ~/.ssh']), [])
})

test('A6 across subcommands, deduped, order preserved', () => {
  assert.deepEqual(
    extractBashReadPaths(['cat a', 'grep x /etc/hosts', 'cat a']),
    ['a', 'x', '/etc/hosts'],
  )
})

test('A7 documented best-effort MISS: a wrapped reader (sudo cat) is not recognized', () => {
  // head is the wrapper 'sudo' (not a reader) → no read paths extracted.
  assert.deepEqual(extractBashReadPaths(['sudo cat /etc/shadow']), [])
})

test('A8 brace-group and ! negation grammar tokens are skipped to the real reader head', () => {
  // splitCommand_DEPRECATED('{ cat ~/.aws/credentials; }') => ['{ cat ~/.aws/credentials','}']
  // — the reader is the FIRST command in the group (runs in the current shell), so the
  // head token is '{'; skip it so the read is still caught (was a fail-open).
  assert.deepEqual(extractBashReadPaths(['{ cat ~/.aws/credentials']), ['~/.aws/credentials'])
  assert.deepEqual(extractBashReadPaths(['! cat /etc/shadow']), ['/etc/shadow'])
  assert.deepEqual(extractBashReadPaths(['{ grep -r secret ~/.ssh']), ['secret', '~/.ssh'])
  // the trailing '}' subcommand yields no head match (no reader) → contributes nothing
  assert.deepEqual(extractBashReadPaths(['}']), [])
})

test('B1 defensive: non-array / hostile elements → no throw, no spurious path', () => {
  assert.deepEqual(extractBashReadPaths(undefined), [])
  assert.deepEqual(extractBashReadPaths('cat /etc/x'), []) // a bare string is not the split form
  assert.deepEqual(extractBashReadPaths(null), [])
  let out
  assert.doesNotThrow(() => {
    out = extractBashReadPaths([null, 42, {}, ['x'], 'cat /etc/x'])
  })
  assert.deepEqual(out, ['/etc/x'])
})

test('B2 READER_BINARIES is a non-empty Set including the common readers', () => {
  assert.ok(READER_BINARIES instanceof Set)
  for (const b of ['cat', 'grep', 'head', 'tail', 'less', 'ls', 'find', 'awk', 'sed', 'xxd']) {
    assert.ok(READER_BINARIES.has(b), `expected reader: ${b}`)
  }
})
