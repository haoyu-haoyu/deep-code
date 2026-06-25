import { test } from 'node:test'
import assert from 'node:assert/strict'

import { orderImagePastesByReference } from '../src/utils/processUserInput/orderImagesByReference.mjs'

const img = id => ({ id, type: 'image' })

test('THE FIX: blocks follow TEXT-reference order, not ascending numeric id', () => {
  // pastedContents iterated by Object.values would give [5, 10]; the text refers
  // to #10 before #5, so the images must be ordered [10, 5].
  const ordered = orderImagePastesByReference([10, 5], [img(5), img(10)])
  assert.deepEqual(ordered.map(i => i.id), [10, 5])
})

test('sequential, in-order ids are unchanged (common case)', () => {
  const ordered = orderImagePastesByReference([1, 2, 3], [img(1), img(2), img(3)])
  assert.deepEqual(ordered.map(i => i.id), [1, 2, 3])
})

test('user-rearranged placeholders reorder the images accordingly', () => {
  // ids 1,2 but the text has [#2] before [#1]
  const ordered = orderImagePastesByReference([2, 1], [img(1), img(2)])
  assert.deepEqual(ordered.map(i => i.id), [2, 1])
})

test('no references (e.g. non-text prompt) preserves the original order', () => {
  const pastes = [img(7), img(3)]
  assert.deepEqual(orderImagePastesByReference([], pastes).map(i => i.id), [7, 3])
})

test('an image not referenced in the text is kept (appended), never dropped', () => {
  // text refs #10 only; #5 has no ref but must survive
  const ordered = orderImagePastesByReference([10], [img(5), img(10)])
  assert.deepEqual(ordered.map(i => i.id), [10, 5])
  assert.equal(ordered.length, 2)
})

test('duplicate refs to the same id do not duplicate the image', () => {
  const ordered = orderImagePastesByReference([10, 10, 5], [img(5), img(10)])
  assert.deepEqual(ordered.map(i => i.id), [10, 5])
})

test('text refs to ids with no matching paste are ignored', () => {
  const ordered = orderImagePastesByReference([99, 10], [img(10)])
  assert.deepEqual(ordered.map(i => i.id), [10])
})
