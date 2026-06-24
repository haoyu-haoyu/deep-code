import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSpanCache } from '../src/ink/spanCache.mjs'

// A compute that mirrors parseToSpans's shape ({text, props}) and counts calls,
// so we can prove the re-segmentation is skipped on a cache hit (the remount win).
function countingCompute() {
  let calls = 0
  const compute = input => {
    calls += 1
    return [{ text: input, props: { color: 'red' } }]
  }
  return { compute, calls: () => calls }
}
const copySpan = s => ({ text: s.text, props: { ...s.props } })

test('THE WIN: a content-identical remount skips the parse (compute runs once)', () => {
  const { compute, calls } = countingCompute()
  const get = createSpanCache(compute, copySpan, 200)
  get('hello world') // first mount
  for (let i = 0; i < 20; i++) get('hello world') // 20 ctrl+o / scroll remounts
  assert.equal(calls(), 1)
})

test('CORRECTNESS: the returned copy can be mutated without poisoning the cache', () => {
  const { compute, calls } = countingCompute()
  const get = createSpanCache(compute, copySpan, 200)
  const first = get('msg')
  // the <Ansi> render mutates a span in place (span.props.dim = true)
  first[0].props.dim = true
  first[0].text = 'CLOBBERED'
  // a later remount of the same content must see the PRISTINE spans
  const second = get('msg')
  assert.equal(calls(), 1) // still a cache hit (no recompute)
  assert.equal(second[0].text, 'msg')
  assert.ok(!('dim' in second[0].props), 'the dim mutation did not leak into the cache')
  // and the two results are distinct objects (independent copies)
  assert.notEqual(first[0], second[0])
  assert.notEqual(first[0].props, second[0].props)
})

test('the copy is byte-identical in content to a fresh compute', () => {
  const { compute } = countingCompute()
  const get = createSpanCache(compute, copySpan, 200)
  assert.deepEqual(get('abc'), [{ text: 'abc', props: { color: 'red' } }])
  assert.deepEqual(get('abc'), [{ text: 'abc', props: { color: 'red' } }]) // hit == miss
})

test('different content recomputes (cache miss)', () => {
  const { compute, calls } = countingCompute()
  const get = createSpanCache(compute, copySpan, 200)
  get('a')
  get('b')
  assert.equal(calls(), 2)
})

test('LRU evicts the least-recently-used beyond maxSize', () => {
  const { compute, calls } = countingCompute()
  const get = createSpanCache(compute, copySpan, 2)
  get('A') // [A]
  get('B') // [A,B]
  get('C') // [B,C] — A evicted
  assert.equal(calls(), 3)
  get('A') // miss — A was evicted
  assert.equal(calls(), 4)
})

test('using an entry promotes it so it is not evicted next (recency)', () => {
  const { compute, calls } = countingCompute()
  const get = createSpanCache(compute, copySpan, 2)
  get('A') // [A]
  get('B') // [A,B]
  get('A') // hit, promote -> [B,A]
  get('C') // [A,C] — B evicted, A kept
  get('A') // still cached -> hit
  assert.equal(calls(), 3) // A,B,C computed once each; A never recomputed
})

test('an empty result array is cached and copied correctly', () => {
  const { compute, calls } = countingCompute()
  const emptyCompute = () => {
    compute('') // count
    return []
  }
  const get = createSpanCache(emptyCompute, copySpan, 200)
  assert.deepEqual(get('x'), [])
  assert.deepEqual(get('x'), [])
  assert.equal(calls(), 1) // hit on the second call
})
