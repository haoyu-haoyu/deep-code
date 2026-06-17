import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveToolCallIndex } from '../src/services/toolCallIndex.mjs'

// The accumulator the assemblers build: Map<slot, { id, ... }>.
const mapOf = entries => new Map(entries)

// --- happy path: a conformant per-call index wins verbatim ---

test('a valid integer index is returned verbatim (even with an id and a non-empty map)', () => {
  // Byte-identity guard: a conformant stream never reaches the id path, so its
  // slot assignment is exactly the wire index regardless of map contents.
  assert.equal(resolveToolCallIndex(new Map(), { index: 0 }), 0)
  assert.equal(resolveToolCallIndex(new Map(), { index: 3 }), 3)
  assert.equal(
    resolveToolCallIndex(mapOf([[0, { id: 'x' }]]), { index: 5, id: 'y' }),
    5,
  )
})

// --- legacy fallbacks (byte-identical to the old `index ?? 0`) ---

test('no index + no id -> slot 0 (legacy single-slot fallback)', () => {
  assert.equal(resolveToolCallIndex(new Map(), {}), 0)
  assert.equal(resolveToolCallIndex(new Map(), { id: undefined }), 0)
})

test('no index + id on an empty map -> slot 0 (single non-conformant call is unchanged)', () => {
  assert.equal(resolveToolCallIndex(new Map(), { id: 'a' }), 0)
})

// --- THE fix: two parallel calls with distinct ids and no index ---

test('two distinct ids with no index get distinct slots (no collapse onto 0)', () => {
  const toolCalls = new Map()
  // first delta of call A
  const slotA = resolveToolCallIndex(toolCalls, { id: 'a', name: 'read' })
  assert.equal(slotA, 0)
  toolCalls.set(slotA, { id: 'a' })
  // first delta of the PARALLEL call B (distinct id, still no index)
  const slotB = resolveToolCallIndex(toolCalls, { id: 'b', name: 'write' })
  assert.equal(slotB, 1, 'B must get its own slot, not overwrite A at 0')
  toolCalls.set(slotB, { id: 'b' })
  // a continuation delta of A (same id) reuses A's slot
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'a' }), 0)
  // a continuation delta of B reuses B's slot
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'b' }), 1)
})

test('a repeated id reuses its existing slot (argument fragments accumulate)', () => {
  const toolCalls = mapOf([
    [0, { id: 'a' }],
    [1, { id: 'b' }],
  ])
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'b' }), 1)
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'a' }), 0)
})

// --- robustness ---

test('a new id takes the smallest free slot, never colliding with a sparse key', () => {
  // Slots 0 and 2 taken -> a new id fills the gap at 1, not collide.
  const toolCalls = mapOf([
    [0, { id: 'x' }],
    [2, { id: 'z' }],
  ])
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'fresh' }), 1)
})

test('id scan ignores entries with no id', () => {
  // An entry created before its id arrived (id undefined) must not capture a
  // delta that carries an id.
  const toolCalls = mapOf([[0, { id: undefined }]])
  assert.equal(resolveToolCallIndex(toolCalls, { id: 'a' }), 1)
})

test('an invalid (negative/float/non-number) index falls through to the id/0 path', () => {
  // Real wire indices are non-negative integers; anything else is normalized
  // away (matches the old readIndex strictness) so it cannot become a slot key.
  assert.equal(resolveToolCallIndex(new Map(), { index: -1, id: 'a' }), 0)
  assert.equal(resolveToolCallIndex(new Map(), { index: 1.5, id: 'a' }), 0)
  assert.equal(resolveToolCallIndex(new Map(), { index: '2', id: 'a' }), 0)
  assert.equal(resolveToolCallIndex(new Map(), { index: null }), 0)
})
