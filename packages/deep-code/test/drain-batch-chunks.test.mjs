import { test } from 'node:test'
import assert from 'node:assert/strict'

import { drainBatchChunks } from '../src/utils/drainBatchChunks.mjs'

// Build a batch of {entry, resolve} where resolve() records the entry as flushed.
function makeBatch(entries, flushed) {
  return entries.map(entry => ({ entry, resolve: () => flushed.push(entry) }))
}

const serialize = e => JSON.stringify(e)
const BIG = 100 * 1024 * 1024

test('happy path: a single sub-cap chunk writes all entries and resolves each', async () => {
  const flushed = []
  const appends = []
  const batch = makeBatch([{ a: 1 }, { b: 2 }, { c: 3 }], flushed)
  const { unwritten, error } = await drainBatchChunks(
    batch,
    c => {
      appends.push(c)
      return Promise.resolve()
    },
    serialize,
    BIG,
  )
  assert.equal(error, null)
  assert.deepEqual(unwritten, [])
  assert.equal(appends.length, 1)
  assert.equal(appends[0], '{"a":1}\n{"b":2}\n{"c":3}\n')
  assert.deepEqual(flushed, [{ a: 1 }, { b: 2 }, { c: 3 }])
})

test('chunk boundary: splits into multiple appends, all entries resolved', async () => {
  const flushed = []
  const appends = []
  // each line is '{"n":N}\n' = 8 bytes; cap 12 -> one line per chunk
  const batch = makeBatch([{ n: 1 }, { n: 2 }, { n: 3 }], flushed)
  const { unwritten, error } = await drainBatchChunks(
    batch,
    c => {
      appends.push(c)
      return Promise.resolve()
    },
    serialize,
    12,
  )
  assert.equal(error, null)
  assert.deepEqual(unwritten, [])
  assert.equal(appends.length, 3)
  assert.deepEqual(flushed, [{ n: 1 }, { n: 2 }, { n: 3 }])
  // every byte is accounted for, in order
  assert.equal(appends.join(''), '{"n":1}\n{"n":2}\n{"n":3}\n')
})

test('THE FIX: append fails on the only chunk -> whole batch returned unwritten, nothing resolved', async () => {
  const flushed = []
  const batch = makeBatch([{ a: 1 }, { b: 2 }], flushed)
  const boom = new Error('ENOSPC')
  const { unwritten, error } = await drainBatchChunks(
    batch,
    () => Promise.reject(boom),
    serialize,
    BIG,
  )
  assert.equal(error, boom)
  assert.deepEqual(flushed, []) // no resolver fired
  assert.equal(unwritten.length, 2) // the exact {entry,resolve} items, for re-queue
  assert.deepEqual(unwritten.map(u => u.entry), [{ a: 1 }, { b: 2 }])
})

test('THE FIX: append fails on the SECOND chunk -> first chunk resolved, remainder returned', async () => {
  const flushed = []
  const batch = makeBatch([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], flushed)
  const boom = new Error('EACCES')
  let calls = 0
  const { unwritten, error } = await drainBatchChunks(
    batch,
    () => {
      calls += 1
      return calls === 1 ? Promise.resolve() : Promise.reject(boom)
    },
    serialize,
    12, // one line per chunk
  )
  assert.equal(error, boom)
  // first chunk (n:1) was appended + resolved; the rest are the unwritten remainder
  assert.deepEqual(flushed, [{ n: 1 }])
  assert.deepEqual(unwritten.map(u => u.entry), [{ n: 2 }, { n: 3 }, { n: 4 }])
})

test('a non-Error throw is normalized to an Error', async () => {
  const batch = makeBatch([{ a: 1 }], [])
  const { error } = await drainBatchChunks(
    batch,
    () => Promise.reject('disk gone'),
    serialize,
    BIG,
  )
  assert.ok(error instanceof Error)
  assert.equal(error.message, 'disk gone')
})

test('a single entry whose line alone reaches the cap is still written and resolved (leading empty-chunk edge)', async () => {
  const flushed = []
  const appends = []
  const batch = makeBatch([{ n: 1 }], flushed) // '{"n":1}\n' = 8 bytes
  const { unwritten, error } = await drainBatchChunks(
    batch,
    c => {
      appends.push(c)
      return Promise.resolve()
    },
    serialize,
    4, // line (8) >= cap (4): boundary fires at i=0 with empty content
  )
  assert.equal(error, null)
  assert.deepEqual(unwritten, [])
  assert.deepEqual(flushed, [{ n: 1 }]) // the entry is durably written + resolved
  // boundary fires once on empty content (preserved from the original loop),
  // then the line lands in its own chunk — net bytes are exactly the one line
  assert.equal(appends.join(''), '{"n":1}\n')
})

test('empty batch is a no-op', async () => {
  let appended = false
  const { unwritten, error } = await drainBatchChunks(
    [],
    () => {
      appended = true
      return Promise.resolve()
    },
    serialize,
    BIG,
  )
  assert.equal(error, null)
  assert.deepEqual(unwritten, [])
  assert.equal(appended, false)
})
