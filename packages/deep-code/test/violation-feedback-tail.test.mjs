import test from 'node:test'
import assert from 'node:assert/strict'

import { appendViolationFeedbackTail } from '../src/deepcode/violation-feedback-tail.mjs'

// ── Wiring the fortress violation-feedback aggregate to the message tail (cache-moat-safe,
// count-delta gated). Pure helper — the manager + message factory are injected.

function fakeManager(count, feedback) {
  return { getViolationCount: () => count, buildViolationFeedback: () => feedback }
}
const makeReminder = text => ({ type: 'user', isMeta: true, message: { content: `<system-reminder>${text}</system-reminder>` } })
const HISTORY = Object.freeze([{ type: 'user', message: { content: 'hi' } }, { type: 'assistant', message: { content: 'ok' } }])

test('A1 no violations (count 0 === lastSurfaced 0) → SAME array reference, default-inert', () => {
  const r = appendViolationFeedbackTail(HISTORY, fakeManager(0, null), 0, makeReminder)
  assert.equal(r.messages, HISTORY) // object-identity → request byte-identical to baseline
  assert.equal(r.surfacedCount, 0)
})

test('A2 a NEW violation (count 1 > lastSurfaced 0) → appends ONE trailing reminder; prefix untouched', () => {
  const r = appendViolationFeedbackTail(HISTORY, fakeManager(1, 'Sandbox policy: 1 violation recorded this session'), 0, makeReminder)
  assert.equal(r.messages.length, HISTORY.length + 1)
  // append-only: every prior message is referentially identical (byte-identical prefix)
  for (let i = 0; i < HISTORY.length; i++) assert.equal(r.messages[i], HISTORY[i])
  const tail = r.messages[r.messages.length - 1]
  assert.equal(tail.isMeta, true)
  assert.match(tail.message.content, /<system-reminder>Sandbox policy: 1 violation/)
  assert.equal(r.surfacedCount, 1)
})

test('A3 a QUIET turn (count unchanged) → NOT re-injected (same array ref) — the dedup', () => {
  const r = appendViolationFeedbackTail(HISTORY, fakeManager(1, 'Sandbox policy: 1 violation recorded this session'), 1, makeReminder)
  assert.equal(r.messages, HISTORY) // unchanged → stable tail → cache hit
  assert.equal(r.surfacedCount, 1)
})

test('A4 another NEW violation (count 2 > lastSurfaced 1) → surfaces again, once', () => {
  const r = appendViolationFeedbackTail(HISTORY, fakeManager(2, 'Sandbox policy: 2 violations recorded this session'), 1, makeReminder)
  assert.equal(r.messages.length, HISTORY.length + 1)
  assert.match(r.messages.at(-1).message.content, /2 violations/)
  assert.equal(r.surfacedCount, 2)
})

test('B1 count changed but feedback null/empty → sync the count, append nothing (no re-check loop)', () => {
  for (const fb of [null, '', undefined, 42]) {
    const r = appendViolationFeedbackTail(HISTORY, fakeManager(3, fb), 1, makeReminder)
    assert.equal(r.messages, HISTORY)
    assert.equal(r.surfacedCount, 3) // advanced so we don't re-build every turn
  }
})

test('B2 fail-safe: a throwing manager / factory / bad inputs → unchanged, never throws', () => {
  const thrower = { getViolationCount: () => { throw new Error('boom') }, buildViolationFeedback: () => 'x' }
  assert.deepEqual(appendViolationFeedbackTail(HISTORY, thrower, 1, makeReminder), { messages: HISTORY, surfacedCount: 1 })
  const fbThrower = { getViolationCount: () => 2, buildViolationFeedback: () => { throw new Error('boom') } }
  assert.deepEqual(appendViolationFeedbackTail(HISTORY, fbThrower, 1, makeReminder), { messages: HISTORY, surfacedCount: 1 })
  const badFactory = () => { throw new Error('boom') }
  assert.deepEqual(appendViolationFeedbackTail(HISTORY, fakeManager(2, 'x'), 1, badFactory), { messages: HISTORY, surfacedCount: 1 })
  // non-array messages / bad lastSurfaced → unchanged, no throw
  assert.doesNotThrow(() => appendViolationFeedbackTail(null, fakeManager(1, 'x'), 0, makeReminder))
  assert.equal(appendViolationFeedbackTail(HISTORY, fakeManager(1, 'x'), NaN, makeReminder).surfacedCount, 1) // NaN→0 → 1>0 → surfaces
})

test('B3 a non-integer/negative count is ignored (unchanged)', () => {
  assert.equal(appendViolationFeedbackTail(HISTORY, fakeManager(-1, 'x'), 0, makeReminder).messages, HISTORY)
  assert.equal(appendViolationFeedbackTail(HISTORY, fakeManager(1.5, 'x'), 0, makeReminder).messages, HISTORY)
})
