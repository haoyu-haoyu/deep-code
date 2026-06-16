import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emptyPermissionState,
  reducePermission,
} from '../src/utils/hooks/permissionAggregate.mjs'

function aggregate(decisions) {
  let state = emptyPermissionState()
  for (const d of decisions) state = reducePermission(state, d)
  return state
}

const DENY = { behavior: 'deny', reason: 'blocked by policy', updatedInput: { a: 1 } }
const ASK = { behavior: 'ask', reason: 'please confirm', updatedInput: { ask: true } }
const ALLOW = { behavior: 'allow', reason: 'ok', updatedInput: { rewritten: true } }
const PASS = { behavior: 'passthrough', reason: 'n/a', updatedInput: { x: 1 } }

// --- the contamination bug: payload must come from the WINNING hook ---

test('an allow hook never leaks its updatedInput under an aggregated deny', () => {
  const s = aggregate([DENY, ALLOW])
  assert.equal(s.behavior, 'deny')
  assert.equal(s.reason, 'blocked by policy') // deny's reason, not erased by allow
  assert.equal(s.updatedInput, undefined) // a deny carries no rewritten input
})

test('a deny carries no updatedInput even when the deny hook itself sent one', () => {
  const s = aggregate([DENY]) // DENY.updatedInput is {a:1}
  assert.equal(s.behavior, 'deny')
  assert.equal(s.updatedInput, undefined)
})

test('ask beats allow and owns the reason + input', () => {
  const s = aggregate([ALLOW, ASK])
  assert.equal(s.behavior, 'ask')
  assert.equal(s.reason, 'please confirm')
  assert.deepEqual(s.updatedInput, { ask: true })
})

test('allow wins when nothing higher, keeping its own reason + input', () => {
  const s = aggregate([ALLOW, PASS])
  assert.equal(s.behavior, 'allow')
  assert.equal(s.reason, 'ok')
  assert.deepEqual(s.updatedInput, { rewritten: true })
})

test('passthrough never sets a permission decision', () => {
  assert.deepEqual(aggregate([PASS]), emptyPermissionState())
})

// --- order independence (hooks finish in nondeterministic arrival order) ---

test('the aggregate is identical for every arrival order of {deny, ask, allow}', () => {
  const perms = [
    [DENY, ASK, ALLOW],
    [DENY, ALLOW, ASK],
    [ASK, DENY, ALLOW],
    [ASK, ALLOW, DENY],
    [ALLOW, DENY, ASK],
    [ALLOW, ASK, DENY],
  ]
  for (const order of perms) {
    const s = aggregate(order)
    assert.equal(s.behavior, 'deny', `order ${order.map(d => d.behavior)}`)
    assert.equal(s.reason, 'blocked by policy')
    assert.equal(s.updatedInput, undefined)
  }
})

test('order independence of ask-vs-allow (no deny present)', () => {
  for (const order of [
    [ASK, ALLOW],
    [ALLOW, ASK],
  ]) {
    const s = aggregate(order)
    assert.equal(s.behavior, 'ask')
    assert.deepEqual(s.updatedInput, { ask: true })
  }
})

// --- identity contract: unchanged → same object (callers detect change by ===) ---

test('reducePermission returns the SAME object when the hook does not beat the aggregate', () => {
  const denyState = reducePermission(emptyPermissionState(), DENY)
  assert.equal(reducePermission(denyState, ALLOW), denyState) // allow can't beat deny
  assert.equal(reducePermission(denyState, ASK), denyState) // ask can't beat deny
  assert.equal(reducePermission(denyState, DENY), denyState) // a second deny is a tie
  assert.equal(reducePermission(denyState, PASS), denyState) // passthrough no-op
  // a strict raise DOES return a new object
  const allowState = reducePermission(emptyPermissionState(), ALLOW)
  assert.notEqual(reducePermission(allowState, ASK), allowState)
})

test('a tie keeps the first-seen decision (both are valid)', () => {
  const d1 = { behavior: 'deny', reason: 'first' }
  const d2 = { behavior: 'deny', reason: 'second' }
  assert.equal(aggregate([d1, d2]).reason, 'first')
})
