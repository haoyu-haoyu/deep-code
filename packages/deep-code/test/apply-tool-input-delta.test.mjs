import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyToolInputDelta } from '../src/utils/applyToolInputDelta.mjs'

// A StreamingToolUse-shaped entry: index + contentBlock (identity-compared by
// the Messages memo) + unparsedToolInput (the accumulated partial JSON).
function entry(index, id) {
  return { index, contentBlock: { id }, unparsedToolInput: '' }
}

test('THE FIX: order is preserved across interleaved deltas to two indices', () => {
  let list = [entry(0, 'A'), entry(1, 'B')]
  list = applyToolInputDelta(list, 0, '{"a":') // delta to A
  list = applyToolInputDelta(list, 1, '{"b":') // delta to B
  list = applyToolInputDelta(list, 0, '1}') // delta to A again
  assert.deepEqual(list.map(e => e.index), [0, 1]) // never reordered
  assert.equal(list[0].unparsedToolInput, '{"a":1}')
  assert.equal(list[1].unparsedToolInput, '{"b":')
})

test('THE PERF FIX: every element keeps its contentBlock reference (memo comparator passes)', () => {
  const a = entry(0, 'A')
  const b = entry(1, 'B')
  const before = [a, b]
  const after = applyToolInputDelta(before, 0, 'x')
  // positional contentBlock identity is preserved → Messages memo skips re-render
  assert.equal(after[0].contentBlock, a.contentBlock)
  assert.equal(after[1].contentBlock, b.contentBlock)
  // the matched element is a fresh object (state update observed), the rest are
  // the same reference
  assert.notEqual(after[0], a)
  assert.equal(after[1], b)
})

test('accumulates identically to the old reducer (string concat, in order)', () => {
  let list = [entry(0, 'A')]
  for (const d of ['{', '"k"', ':', '42', '}']) {
    list = applyToolInputDelta(list, 0, d)
  }
  assert.equal(list[0].unparsedToolInput, '{"k":42}')
})

test('returns the SAME list reference when no entry matches the index', () => {
  const list = [entry(0, 'A')]
  const out = applyToolInputDelta(list, 5, 'x')
  assert.equal(out, list) // no-op, no new array
})

test('a new array is returned on a match (does not mutate the input)', () => {
  const a = entry(0, 'A')
  const list = [a]
  const out = applyToolInputDelta(list, 0, 'x')
  assert.notEqual(out, list)
  assert.equal(a.unparsedToolInput, '') // input element untouched
})

test('non-array input is returned as-is', () => {
  assert.equal(applyToolInputDelta(null, 0, 'x'), null)
  assert.equal(applyToolInputDelta(undefined, 0, 'x'), undefined)
})
