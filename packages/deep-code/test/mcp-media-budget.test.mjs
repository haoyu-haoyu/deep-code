import { test } from 'node:test'
import assert from 'node:assert/strict'

import { overBudgetMediaIndices } from '../src/services/mcp/mcpMediaBudget.mjs'

const img = { type: 'image', data: 'AAAA', mimeType: 'image/png' }
const audio = { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }
const blobRes = { type: 'resource', resource: { blob: 'AAAA', uri: 'x' } }
const textRes = { type: 'resource', resource: { text: 'hi', uri: 'x' } }
const text = { type: 'text', text: 'hello' }
const link = { type: 'resource_link', uri: 'x' }

test('under budget: nothing is over budget', () => {
  const over = overBudgetMediaIndices([img, audio, text, blobRes], 100)
  assert.equal(over.size, 0)
})

test('THE FIX: media blocks beyond the cap are over budget (decode skipped)', () => {
  const blocks = [img, img, img, img, img]
  const over = overBudgetMediaIndices(blocks, 2)
  // first 2 media allowed; indices 2,3,4 over budget
  assert.deepEqual([...over].sort((a, b) => a - b), [2, 3, 4])
})

test('only MEDIA blocks count toward the budget; text/link never do', () => {
  // text + resource_link + text-resource are not media → don't consume budget
  const blocks = [text, link, textRes, img, text, img, link, img]
  const over = overBudgetMediaIndices(blocks, 2)
  // media are at indices 3,5,7; first 2 (3,5) allowed, index 7 over budget
  assert.deepEqual([...over], [7])
  // the non-media blocks are never flagged
  for (const i of [0, 1, 2, 4, 6]) assert.ok(!over.has(i))
})

test('a blob-bearing resource counts as media; a text resource does not', () => {
  const over = overBudgetMediaIndices([textRes, blobRes, blobRes], 1)
  // media are indices 1,2; first (1) allowed, index 2 over budget
  assert.deepEqual([...over], [2])
})

test('budget of 0 flags every media block', () => {
  const over = overBudgetMediaIndices([img, text, audio], 0)
  assert.deepEqual([...over].sort((a, b) => a - b), [0, 2])
})

test('non-array / malformed input is handled', () => {
  assert.equal(overBudgetMediaIndices(undefined, 100).size, 0)
  assert.equal(overBudgetMediaIndices(null, 100).size, 0)
  assert.equal(overBudgetMediaIndices([null, 'x', {}, { type: 'image' }], 0).size, 1)
})
