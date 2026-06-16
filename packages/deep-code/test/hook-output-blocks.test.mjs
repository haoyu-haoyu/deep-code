import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hookOutputBlocks } from '../src/utils/hooks/hookOutputBlocks.mjs'

// --- the bug: exit 2 + parseable JSON on stdout must still block ---

test('exit code 2 blocks even when the hook also printed a JSON object', () => {
  // The empty object validates against the (all-optional) hook schema, which is
  // exactly what made the REPL path return success before reaching its exit-2
  // branch. The block decision must NOT depend on whether JSON was printed.
  assert.equal(hookOutputBlocks({ status: 2, json: {} }), true)
  assert.equal(hookOutputBlocks({ status: 2, json: { foo: 'bar' } }), true)
  assert.equal(hookOutputBlocks({ status: 2, json: { suppressOutput: true } }), true)
})

test('exit code 2 with no JSON blocks (plain stderr feedback)', () => {
  assert.equal(hookOutputBlocks({ status: 2 }), true)
  assert.equal(hookOutputBlocks({ status: 2, json: null }), true)
})

// --- JSON decision: 'block' blocks regardless of exit code ---

test('a sync JSON decision:block blocks on a zero exit', () => {
  assert.equal(hookOutputBlocks({ status: 0, json: { decision: 'block' } }), true)
})

// --- non-blocking cases ---

test('success and non-blocking results do not block', () => {
  assert.equal(hookOutputBlocks({ status: 0, json: {} }), false)
  assert.equal(hookOutputBlocks({ status: 0 }), false)
  assert.equal(hookOutputBlocks({ status: 0, json: { decision: 'approve' } }), false)
  assert.equal(hookOutputBlocks({ status: 0, json: null }), false)
  // a non-2 non-zero exit is a non-critical error elsewhere, not a block here
  assert.equal(hookOutputBlocks({ status: 1, json: {} }), false)
  assert.equal(hookOutputBlocks({ status: 127 }), false)
})

// --- async hook responses never block from here (they are finalized later) ---

test('async hook output never blocks, even at exit 2 or decision:block', () => {
  assert.equal(
    hookOutputBlocks({ status: 2, json: { async: true }, isAsync: true }),
    false,
  )
  assert.equal(
    hookOutputBlocks({ status: 0, json: { decision: 'block' }, isAsync: true }),
    false,
  )
})

// --- parity with the headless twin's previous inline formula ---

test('matches the executeHooksOutsideREPL formula for every non-async input', () => {
  // old twin: blocked = status === 2 || (json && !async && sync && decision==='block')
  // For non-async json, isSyncHookJSONOutput is true whenever it validated, so
  // the leaf's `json.decision === 'block'` is equivalent.
  const oldTwin = (status, json) => {
    const jsonBlocked = json && json.decision === 'block'
    return status === 2 || !!jsonBlocked
  }
  const jsons = [
    null,
    {},
    { decision: 'block' },
    { decision: 'approve' },
    { suppressOutput: true },
    { systemMessage: 'hi' },
  ]
  for (const status of [0, 1, 2, 127]) {
    for (const json of jsons) {
      assert.equal(
        hookOutputBlocks({ status, json, isAsync: false }),
        oldTwin(status, json),
        `parity mismatch status=${status} json=${JSON.stringify(json)}`,
      )
    }
  }
})
