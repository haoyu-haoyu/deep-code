import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatGitStatusBody } from '../src/context/gitStatusBody.mjs'

test('non-empty status is returned verbatim (regardless of exit code)', () => {
  assert.equal(formatGitStatusBody(' M a.txt\n?? b.txt', 0), ' M a.txt\n?? b.txt')
  // Even if a code were somehow non-zero, a non-empty body is the real status.
  assert.equal(formatGitStatusBody(' M a.txt', 1), ' M a.txt')
})

test('empty status with exit code 0 → "(clean)" (genuinely clean tree)', () => {
  assert.equal(formatGitStatusBody('', 0), '(clean)')
})

test('BUG FIXED: empty status with a NON-ZERO exit → not "(clean)"', () => {
  // A dirty tree whose `git status` errored (locked/corrupt index, failing
  // hook) used to be reported to the model as clean. It must not be.
  const out = formatGitStatusBody('', 128)
  assert.notEqual(out, '(clean)')
  assert.match(out, /unable to read git status/)
  assert.match(out, /git status/) // tells the model how to see the real state
})

test('a truncated (non-empty) status is still shown, never collapsed to a state word', () => {
  const truncated = 'x'.repeat(2000) + '\n... (truncated ...)'
  assert.equal(formatGitStatusBody(truncated, 0), truncated)
})

test('the clean/error branches only diverge on the exit code for an empty body', () => {
  // Same empty text, different code → different message; this is the whole fix.
  assert.notEqual(formatGitStatusBody('', 0), formatGitStatusBody('', 1))
})
