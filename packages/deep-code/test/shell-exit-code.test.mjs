import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shellExitCode } from '../src/utils/shellExitCode.mjs'

test('a numeric code passes through (including 0)', () => {
  assert.equal(shellExitCode(0, null), 0)
  assert.equal(shellExitCode(7, null), 7)
  assert.equal(shellExitCode(137, null), 137)
  // a numeric code wins even if a signal is also (unexpectedly) present
  assert.equal(shellExitCode(2, 'SIGTERM'), 2)
})

test('a signalled exit maps to 128 + signum', () => {
  // THE bug: a SIGTERM'd child must report 143 (128+15), not 144 (SIGUSR1).
  assert.equal(shellExitCode(null, 'SIGTERM'), 143)
  assert.notEqual(shellExitCode(null, 'SIGTERM'), 144)
  assert.equal(shellExitCode(null, 'SIGINT'), 130)
  assert.equal(shellExitCode(null, 'SIGHUP'), 129)
  assert.equal(shellExitCode(null, 'SIGKILL'), 137)
})

test('an unknown signal name maps to 128 + 1', () => {
  assert.equal(shellExitCode(null, 'SIGMADEUP'), 129)
})

test('neither code nor signal → 1', () => {
  assert.equal(shellExitCode(null, null), 1)
  assert.equal(shellExitCode(undefined, undefined), 1)
})

// Parity with the full-CLI wrapper's resolveFullCliExitCode, which now
// delegates to this SSOT (deepcode-package.test.mjs pins the same vectors).
test('matches the resolveFullCliExitCode contract', async () => {
  const { resolveFullCliExitCode } = await import('../src/deepcode/front-controller.mjs')
  for (const [code, signal] of [
    [0, null],
    [7, null],
    [null, 'SIGTERM'],
    [null, 'SIGINT'],
    [null, 'SIGHUP'],
    [null, 'SIGKILL'],
    [null, null],
    [null, 'SIGMADEUP'],
  ]) {
    assert.equal(shellExitCode(code, signal), resolveFullCliExitCode(code, signal))
  }
})
