import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveFlushedQueue } from '../src/utils/resolveFlushedQueue.mjs'

// resolveFlushedQueue(flushedBatch, laterEntries, succeeded)
//   succeeded → batch durably written → keep only laterEntries
//   failed    → re-queue batch AHEAD of laterEntries (oldest-first preserved)

test('a successful flush consumes the batch, keeping only entries added during it', () => {
  assert.deepEqual(resolveFlushedQueue(['a', 'b'], ['c'], true), ['c'])
  assert.deepEqual(resolveFlushedQueue(['a'], [], true), [])
})

test('a failed flush re-queues the batch AHEAD of later entries (order preserved)', () => {
  assert.deepEqual(
    resolveFlushedQueue(['a', 'b'], ['c', 'd'], false),
    ['a', 'b', 'c', 'd'],
  )
  assert.deepEqual(resolveFlushedQueue(['a'], [], false), ['a'])
})

test('no entries added during the write: failure retains exactly the batch', () => {
  assert.deepEqual(resolveFlushedQueue(['x', 'y', 'z'], [], false), ['x', 'y', 'z'])
})

test('empty batch is a no-op either way', () => {
  assert.deepEqual(resolveFlushedQueue([], ['c'], false), ['c'])
  assert.deepEqual(resolveFlushedQueue([], ['c'], true), ['c'])
  assert.deepEqual(resolveFlushedQueue([], [], true), [])
})

test('does not mutate its inputs', () => {
  const batch = ['a', 'b']
  const later = ['c']
  const out = resolveFlushedQueue(batch, later, false)
  assert.deepEqual(out, ['a', 'b', 'c'])
  assert.deepEqual(batch, ['a', 'b']) // untouched
  assert.deepEqual(later, ['c']) // untouched
})
