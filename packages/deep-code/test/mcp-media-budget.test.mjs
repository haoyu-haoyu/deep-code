import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  base64DecodedByteLength,
  mediaBudgetRejectionReason,
  overBudgetMediaIndices,
} from '../src/services/mcp/mcpMediaBudget.mjs'

const img = { type: 'image', data: 'AAAA', mimeType: 'image/png' }
const audio = { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }
const blobRes = { type: 'resource', resource: { blob: 'AAAA', uri: 'x' } }
const textRes = { type: 'resource', resource: { text: 'hi', uri: 'x' } }
const text = { type: 'text', text: 'hello' }
const link = { type: 'resource_link', uri: 'x' }

// `[...over.keys()]` — the over-budget index set, regardless of reason code.
const idx = over => [...over.keys()].sort((a, b) => a - b)

test('under budget: nothing is over budget', () => {
  const over = overBudgetMediaIndices([img, audio, text, blobRes], 100)
  assert.equal(over.size, 0)
})

test('media blocks beyond the COUNT cap are over budget (reason=count)', () => {
  const blocks = [img, img, img, img, img]
  const over = overBudgetMediaIndices(blocks, 2)
  // first 2 media allowed; indices 2,3,4 over budget
  assert.deepEqual(idx(over), [2, 3, 4])
  for (const i of [2, 3, 4]) assert.equal(over.get(i), 'count')
})

test('only MEDIA blocks count toward the budget; text/link never do', () => {
  const blocks = [text, link, textRes, img, text, img, link, img]
  const over = overBudgetMediaIndices(blocks, 2)
  // media are at indices 3,5,7; first 2 (3,5) allowed, index 7 over budget
  assert.deepEqual(idx(over), [7])
  for (const i of [0, 1, 2, 4, 6]) assert.ok(!over.has(i))
})

test('a blob-bearing resource counts as media; a text resource does not', () => {
  const over = overBudgetMediaIndices([textRes, blobRes, blobRes], 1)
  assert.deepEqual(idx(over), [2])
})

test('budget of 0 flags every media block', () => {
  const over = overBudgetMediaIndices([img, text, audio], 0)
  assert.deepEqual(idx(over), [0, 2])
})

test('non-array / malformed input is handled', () => {
  assert.equal(overBudgetMediaIndices(undefined, 100).size, 0)
  assert.equal(overBudgetMediaIndices(null, 100).size, 0)
  assert.equal(
    overBudgetMediaIndices([null, 'x', {}, { type: 'image' }], 0).size,
    1,
  )
})

// ---- per-block SIZE cap (the new axis) ----

test('base64DecodedByteLength: ~3/4 of base64 length, robust to junk', () => {
  assert.equal(base64DecodedByteLength(0), 0)
  assert.equal(base64DecodedByteLength(4), 3)
  assert.equal(base64DecodedByteLength(8), 6)
  assert.equal(base64DecodedByteLength(undefined), 0)
  assert.equal(base64DecodedByteLength(-5), 0)
})

test('THE FIX: a single media block over the byte cap is over budget (reason=size)', () => {
  // maxDecodedBytes=6 -> base64 length must exceed 8 to trip (floor(len*3/4) > 6).
  const big = { type: 'audio', data: 'A'.repeat(40), mimeType: 'audio/wav' }
  const blocks = [img, big] // img data 'AAAA' -> 3 bytes (under), big -> 30 bytes (over)
  const over = overBudgetMediaIndices(blocks, 100, 6)
  assert.deepEqual(idx(over), [1])
  assert.equal(over.get(1), 'size')
  assert.ok(!over.has(0), 'small image stays under the byte cap')
})

test('size cap applies to image, audio, and blob-resource payloads alike', () => {
  const bigImg = { type: 'image', data: 'A'.repeat(40), mimeType: 'image/png' }
  const bigBlob = { type: 'resource', resource: { blob: 'A'.repeat(40), uri: 'x' } }
  const over = overBudgetMediaIndices([bigImg, text, bigBlob], 100, 6)
  assert.deepEqual(idx(over), [0, 2])
  assert.equal(over.get(0), 'size')
  assert.equal(over.get(2), 'size')
})

test('default byte cap is Infinity: pure-count behaviour preserved', () => {
  const huge = { type: 'image', data: 'A'.repeat(10000), mimeType: 'image/png' }
  // no third arg -> only the count axis applies
  const over = overBudgetMediaIndices([huge, huge], 5)
  assert.equal(over.size, 0)
})

test('count cap takes precedence over size for a beyond-count block', () => {
  // a block that is BOTH beyond count and oversized is reported as 'count'
  const big = { type: 'image', data: 'A'.repeat(40), mimeType: 'image/png' }
  const over = overBudgetMediaIndices([img, img, big], 2, 6)
  assert.equal(over.get(2), 'count')
})

test('mediaBudgetRejectionReason: distinct text per reason code', () => {
  assert.match(
    mediaBudgetRejectionReason('count', 100, '100 MB'),
    /per-result media budget of 100/,
  )
  assert.match(
    mediaBudgetRejectionReason('size', 100, '100 MB'),
    /media block size limit of 100 MB/,
  )
  // undefined code defaults to the count message
  assert.match(
    mediaBudgetRejectionReason(undefined, 7, '1 MB'),
    /per-result media budget of 7/,
  )
})
