import { test } from 'node:test'
import assert from 'node:assert/strict'

import { flattenSettledBlocks } from '../src/services/mcp/flattenSettledBlocks.mjs'

const ok = value => ({ status: 'fulfilled', value })
const err = reason => ({ status: 'rejected', reason })

test('a single bad block degrades to a placeholder but keeps every valid sibling', () => {
  // The bug: Promise.all rejected the WHOLE result on one throwing block, so the
  // text answer in a valid sibling was lost. Now only the bad block degrades.
  const blocks = [
    { type: 'text', text: 'the answer' },
    { type: 'image', data: '', mimeType: 'image/png' },
  ]
  const settled = [
    ok([{ type: 'text', text: 'the answer the model needs' }]),
    err(new Error('Image file is empty (0 bytes)')),
  ]
  const { content, rejected } = flattenSettledBlocks(settled, blocks, 'slack')
  assert.deepEqual(content, [
    { type: 'text', text: 'the answer the model needs' },
    {
      type: 'text',
      text: '[image block from slack could not be rendered: Image file is empty (0 bytes)]',
    },
  ])
  assert.deepEqual(rejected, [
    { blockType: 'image', reason: 'Image file is empty (0 bytes)' },
  ])
})

test('all blocks fulfilled → flattened in order, no placeholders, no rejections', () => {
  const settled = [
    ok([{ type: 'text', text: 'a' }]),
    ok([
      { type: 'text', text: 'b1' },
      { type: 'image', source: {} },
    ]),
  ]
  const { content, rejected } = flattenSettledBlocks(settled, [{}, {}], 'srv')
  assert.equal(content.length, 3)
  assert.equal(rejected.length, 0)
  assert.deepEqual(content[2], { type: 'image', source: {} })
})

test('a non-Error rejection reason and a typeless block degrade cleanly', () => {
  const settled = [err('boom'), err(new TypeError('bad base64'))]
  const blocks = [null, { notype: true }]
  const { content, rejected } = flattenSettledBlocks(settled, blocks, 'x')
  assert.deepEqual(content, [
    { type: 'text', text: '[block block from x could not be rendered: boom]' },
    { type: 'text', text: '[block block from x could not be rendered: bad base64]' },
  ])
  assert.equal(rejected.length, 2)
})

test('empty result → empty content, empty rejections', () => {
  assert.deepEqual(flattenSettledBlocks([], [], 'x'), { content: [], rejected: [] })
})
