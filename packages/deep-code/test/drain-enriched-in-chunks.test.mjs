import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drainEnrichedInChunks } from '../src/utils/drainEnrichedInChunks.mjs'

// The EXACT serial loop from sessionStorage.ts enrichLogs — the equivalence oracle.
async function serialOracle({ items, startIndex, count, enrichOne }) {
  const results = []
  let i = startIndex
  while (i < items.length && results.length < count) {
    const item = items[i]
    i++
    const value = await enrichOne(item)
    if (value) results.push(value)
  }
  return { results, nextIndex: i }
}

// Synthetic item: { id, keep }. enrichOne returns the item when kept, null when
// filtered — mirroring enrichLog returning a LogOption or null.
const enrichOne = item => Promise.resolve(item.keep ? item : null)

function assertEquivalent(items, startIndex, count, chunkSize) {
  return Promise.all([
    serialOracle({ items, startIndex, count, enrichOne }),
    drainEnrichedInChunks({ items, startIndex, count, chunkSize, enrichOne }),
  ]).then(([oracle, chunked]) => {
    const ctx = `items=${items.length} start=${startIndex} count=${count} chunk=${chunkSize}`
    assert.equal(chunked.nextIndex, oracle.nextIndex, `nextIndex mismatch (${ctx})`)
    assert.deepEqual(
      chunked.results.map(r => r.id),
      oracle.results.map(r => r.id),
      `results mismatch (${ctx})`,
    )
  })
}

test('hand cases: empty / all-kept / all-filtered / count=0 / count>available', async () => {
  const allKept = Array.from({ length: 10 }, (_, i) => ({ id: i, keep: true }))
  const allFiltered = Array.from({ length: 10 }, (_, i) => ({ id: i, keep: false }))
  await assertEquivalent([], 0, 5, 8)
  await assertEquivalent(allKept, 0, 5, 8)
  await assertEquivalent(allKept, 0, 100, 8) // count > available
  await assertEquivalent(allKept, 0, 0, 8) // count=0 -> no scan
  await assertEquivalent(allFiltered, 0, 5, 8) // all filtered -> scan to end
  await assertEquivalent(allKept, 7, 5, 8) // startIndex past some
  await assertEquivalent(allKept, 10, 5, 8) // startIndex at end
})

test('count-th kept lands exactly at a chunk boundary (no over-advance of nextIndex)', async () => {
  // keep at indices 0..; chunk=4; count=4 -> 4th kept at index 3 (last of chunk 1).
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i, keep: true }))
  await assertEquivalent(items, 0, 4, 4)
  // count=5 -> 5th kept at index 4 (first of chunk 2): the over-read of chunk 1's
  // tail must not advance nextIndex past index 5.
  await assertEquivalent(items, 0, 5, 4)
})

test('filtered items interleaved at boundaries', async () => {
  const items = [
    { id: 0, keep: true }, { id: 1, keep: false }, { id: 2, keep: false },
    { id: 3, keep: true }, { id: 4, keep: true }, { id: 5, keep: false },
    { id: 6, keep: true }, { id: 7, keep: false }, { id: 8, keep: true },
  ]
  for (const chunk of [1, 2, 3, 4, 8, 100]) {
    for (let count = 0; count <= 6; count++) {
      for (let start = 0; start <= items.length; start++) {
        await assertEquivalent(items, start, count, chunk)
      }
    }
  }
})

test('chunkSize=1 degenerates to exactly serial', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: i, keep: i % 3 !== 0 }))
  for (let count = 0; count <= 10; count++) {
    await assertEquivalent(items, 0, count, 1)
  }
})

test('seeded fuzz: chunked == serial for random lists / filters / params', async () => {
  // Deterministic LCG so a failure is reproducible.
  let seed = 0x9e3779b9
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let iter = 0; iter < 3000; iter++) {
    const n = Math.floor(rnd() * 40)
    const items = Array.from({ length: n }, (_, i) => ({ id: i, keep: rnd() < 0.6 }))
    const startIndex = Math.floor(rnd() * (n + 2))
    const count = Math.floor(rnd() * (n + 2))
    const chunkSize = 1 + Math.floor(rnd() * 10)
    await assertEquivalent(items, startIndex, count, chunkSize)
  }
})
