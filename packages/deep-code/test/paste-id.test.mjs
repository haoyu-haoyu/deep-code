import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcilePasteId } from '../src/components/PromptInput/pasteId.mjs'

test('counter floor wins when it exceeds every live id', () => {
  // counter has advanced (prior pastes pruned from the map); floor must hold.
  assert.equal(reconcilePasteId(10, { 1: {}, 2: {} }, [1, 2]), 10)
})

test('resyncs to map-key max + 1 when the map exceeds the counter', () => {
  // maybeTruncateInput wrote a high id; a lagging counter must skip past it.
  assert.equal(reconcilePasteId(2, { 1: {}, 5: {} }, []), 6)
})

test('skips a live map id equal to the counter floor (the cross-allocator collision)', () => {
  // The exact bug: the counter sits at 3, but the truncate path already wrote
  // id 3 into the map. Allocating must skip past 3, not hand it out again.
  // No matching ref here, so only the map loop can catch it.
  assert.equal(reconcilePasteId(3, { 3: {} }, []), 4)
})

test('resyncs to ref-id max + 1 when an input ref exceeds map and counter', () => {
  // Placeholder ref present in the input text but its setPastedContents has not
  // committed yet — the ref id still has to be skipped.
  assert.equal(reconcilePasteId(2, { 1: {} }, [7]), 8)
})

test('regression: truncate-then-image cannot reuse an id', () => {
  // 1. Empty map, fresh counter at 1 -> truncate path allocates id 1.
  const truncId = reconcilePasteId(1, {}, [])
  assert.equal(truncId, 1)
  // The truncated placeholder is now live in the map (and its ref in the input).
  const mapAfterTrunc = { [truncId]: {} }
  // 2. Image paste via the counter (still at 1) must NOT return 1 again.
  const imgId = reconcilePasteId(1, mapAfterTrunc, [truncId])
  assert.notEqual(imgId, truncId)
  assert.equal(imgId, 2)
})

test('never returns an id <= any live id (monotonic over a paste sequence)', () => {
  // Drive many interleaved allocations and assert no id is ever reused.
  let counter = 1
  const map = {}
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const refIds = Object.keys(map).map(Number)
    // Alternate between the counter path (advances floor) and the truncate path
    // (floor 1) to mimic both allocators racing on the same map.
    const floor = i % 3 === 0 ? 1 : counter
    const id = reconcilePasteId(floor, map, refIds)
    assert.ok(!seen.has(id), `id ${id} reused at step ${i}`)
    // Every prior live id must be strictly less than the new id.
    for (const live of seen) assert.ok(id > live)
    seen.add(id)
    map[id] = {}
    counter = id + 1
    // Occasionally prune a low id from the map (counter stays ahead).
    if (i % 5 === 4) delete map[Math.min(...Object.keys(map).map(Number))]
  }
})

test('invalid / non-integer inputs fall back safely', () => {
  assert.equal(reconcilePasteId(-1, {}, []), 1) // sentinel counter -> floor 1
  assert.equal(reconcilePasteId(0, {}, []), 1)
  assert.equal(reconcilePasteId(undefined, {}, []), 1)
  assert.equal(reconcilePasteId(1, null, undefined), 1) // missing map/refs
  // Non-integer map keys and ref ids are ignored, integers still counted.
  assert.equal(reconcilePasteId(1, { foo: {}, 3: {} }, [Number.NaN, 4]), 5)
})
