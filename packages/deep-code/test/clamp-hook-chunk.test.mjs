import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clampHookChunk } from '../src/utils/clampHookChunk.mjs'

test('a chunk well under the cap passes through unchanged (happy path)', () => {
  assert.deepEqual(clampHookChunk(0, 'hello', 100), { keep: 'hello', exceeded: false })
  assert.deepEqual(clampHookChunk(40, 'world', 100), { keep: 'world', exceeded: false })
})

test('an empty chunk is kept with no exceed', () => {
  assert.deepEqual(clampHookChunk(0, '', 100), { keep: '', exceeded: false })
  // even at the cap, an empty chunk does not trip the limit
  assert.deepEqual(clampHookChunk(100, '', 100), { keep: '', exceeded: true })
})

test('a chunk that exactly fills the remaining space is kept, not yet exceeded', () => {
  // currentLength=95, chunk=5, max=100 → fits exactly
  assert.deepEqual(clampHookChunk(95, 'abcde', 100), { keep: 'abcde', exceeded: false })
})

test('a chunk that overflows is truncated to the remaining space and flagged', () => {
  // currentLength=98, chunk length 5, max=100 → keep 2 chars, exceeded
  assert.deepEqual(clampHookChunk(98, 'abcde', 100), { keep: 'ab', exceeded: true })
})

test('once at the cap, further chunks keep nothing and are flagged', () => {
  assert.deepEqual(clampHookChunk(100, 'more', 100), { keep: '', exceeded: true })
})

test('a current length already over the cap (defensive) keeps nothing, flagged', () => {
  assert.deepEqual(clampHookChunk(150, 'more', 100), { keep: '', exceeded: true })
})

test('the kept prefix is the leading bytes (order preserved)', () => {
  const { keep, exceeded } = clampHookChunk(0, 'abcdefghij', 4)
  assert.equal(keep, 'abcd')
  assert.equal(exceeded, true)
})

test('realistic cap: a 1-char overflow past 50M chars truncates and flags', () => {
  const MAX = 50 * 1024 * 1024
  const { keep, exceeded } = clampHookChunk(MAX - 3, 'abcde', MAX)
  assert.equal(keep, 'abc') // only the 3 remaining chars kept
  assert.equal(exceeded, true)
})
