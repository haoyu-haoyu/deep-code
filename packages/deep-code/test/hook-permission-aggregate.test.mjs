import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emptyPermissionState,
  reducePermission,
} from '../src/utils/hooks/permissionAggregate.mjs'
import { hookBlockPermissionBehavior } from '../src/utils/hooks/hookBlockPermissionBehavior.mjs'

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

// --- exit-2 PreToolUse deny must enter the aggregator (the fail-open fix) ---

test('hookBlockPermissionBehavior emits deny ONLY for PreToolUse', () => {
  assert.equal(hookBlockPermissionBehavior('PreToolUse'), 'deny')
  for (const e of [
    'PostToolUse',
    'Stop',
    'SubagentStop',
    'UserPromptSubmit',
    'SessionStart',
    'PermissionRequest',
    'Notification',
    '',
    undefined,
  ]) {
    assert.equal(hookBlockPermissionBehavior(e), undefined, `${e} must NOT emit a permissionBehavior`)
  }
})

test('an exit-2 PreToolUse deny survives a racing allow in BOTH arrival orders', () => {
  // The fix routes the exit-2 deny through permissionBehavior (= a deny decision),
  // so the order-independent aggregator keeps it whether it arrives before or after
  // a concurrent JSON allow — closing the order-dependent permission fail-open.
  const exitTwoDeny = {
    behavior: hookBlockPermissionBehavior('PreToolUse'),
    reason: '[guard.sh]: blocked by policy', // the detailed stderr message, preserved
  }
  assert.equal(exitTwoDeny.behavior, 'deny')

  const denyFirst = aggregate([exitTwoDeny, ALLOW])
  assert.equal(denyFirst.behavior, 'deny', 'deny-arrives-first must stay deny')
  assert.equal(denyFirst.reason, '[guard.sh]: blocked by policy', 'detailed reason preserved')

  const allowFirst = aggregate([ALLOW, exitTwoDeny])
  assert.equal(allowFirst.behavior, 'deny', 'allow-arrives-first must still be overridden by deny')
  assert.equal(allowFirst.reason, '[guard.sh]: blocked by policy')

  // parity with a JSON-block deny (which already set permissionBehavior:'deny')
  assert.equal(aggregate([DENY, ALLOW]).behavior, 'deny')
  assert.equal(aggregate([ALLOW, DENY]).behavior, 'deny')
})

test('fuzz: an exit-2 deny anywhere in a hook set wins order-independently', () => {
  const exitTwoDeny = { behavior: hookBlockPermissionBehavior('PreToolUse'), reason: 'x2' }
  const pool = [ALLOW, ASK, PASS, exitTwoDeny]
  let s = 0x1234567 >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  for (let iter = 0; iter < 2000; iter++) {
    const n = 2 + ((rnd() * 4) | 0)
    const decisions = [exitTwoDeny] // ensure a deny is present
    for (let k = 0; k < n; k++) decisions.push(pool[(rnd() * pool.length) | 0])
    // shuffle
    for (let i = decisions.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0
      ;[decisions[i], decisions[j]] = [decisions[j], decisions[i]]
    }
    assert.equal(aggregate(decisions).behavior, 'deny', `iter ${iter}: deny must always win`)
  }
})
