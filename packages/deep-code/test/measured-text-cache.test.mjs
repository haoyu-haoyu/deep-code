import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createKeyedCache } from '../src/utils/measuredTextCache.mjs'

// A build that tags each result and counts calls, so we can prove redundant
// rebuilds are eliminated (the measured perf win) deterministically — no timing.
function countingBuild() {
  let calls = 0
  const build = (text, columns) => {
    calls += 1
    return { text, columns, id: calls } // a fresh object each real build
  }
  return { build, calls: () => calls }
}

test('a repeated (text, columns) returns the SAME instance (no rebuild)', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  const a = get('hello', 80)
  const b = get('hello', 80)
  assert.strictEqual(a, b) // reference identity
  assert.equal(calls(), 1) // built once, reused
})

test('THE WIN: type once + 50 cursor-only moves rebuilds the MeasuredText ONCE, not 51 times', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  const text = 'a 300-char prompt '.repeat(17)
  get(text, 79) // initial render after typing
  for (let i = 0; i < 50; i++) get(text, 79) // arrow keys / focus blink / anim ticks
  assert.equal(calls(), 1) // 50 redundant wrapAnsi+segmentation passes eliminated
})

test('a different text rebuilds (cache miss)', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  get('hello', 80)
  const b = get('hellp', 80)
  assert.equal(calls(), 2)
  assert.equal(b.text, 'hellp')
})

test('a different columns (terminal resize) rebuilds — never serves a stale wrap', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  const a = get('hello', 80)
  const b = get('hello', 100)
  assert.notStrictEqual(a, b)
  assert.equal(calls(), 2)
  assert.equal(b.columns, 100)
})

test('LRU evicts the least-recently-used beyond maxSize (bounds retention)', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  const a1 = get('A', 80) // [A]
  get('B', 80) // [A, B]
  get('C', 80) // [B, C] — A evicted
  assert.equal(calls(), 3)
  const a2 = get('A', 80) // miss — A was evicted -> rebuilt
  assert.equal(calls(), 4)
  assert.notStrictEqual(a1, a2)
})

test('using a key promotes it so it is not evicted next (recency)', () => {
  const { build, calls } = countingBuild()
  const get = createKeyedCache(build, 2)
  const a1 = get('A', 80) // [A]
  get('B', 80) // [A, B]
  const a1again = get('A', 80) // hit, promotes A -> [B, A]
  assert.strictEqual(a1, a1again)
  get('C', 80) // [A, C] — B evicted (not A)
  const aStill = get('A', 80) // still cached -> same instance
  assert.strictEqual(a1, aStill)
  assert.equal(calls(), 3) // A, B, C built once each; A never rebuilt
})

test('a single-slot cache (maxSize 1) still never returns a wrong instance', () => {
  const { build } = countingBuild()
  const get = createKeyedCache(build, 1)
  const a = get('A', 80)
  assert.strictEqual(get('A', 80), a) // immediate repeat hits
  get('B', 80) // evicts A
  assert.notStrictEqual(get('A', 80), a) // rebuilt, but a correct A
  assert.equal(get('A', 80).text, 'A')
})
