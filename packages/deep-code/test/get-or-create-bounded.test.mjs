import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getOrCreateBounded } from '../src/utils/getOrCreateBounded.mjs'

test('returns the same value on a hit; the factory runs only once', () => {
  const map = new Map()
  let calls = 0
  const a = getOrCreateBounded(map, 'k', () => ({ n: ++calls }), 8)
  const b = getOrCreateBounded(map, 'k', () => ({ n: ++calls }), 8)
  assert.equal(a, b) // same stored reference
  assert.equal(calls, 1)
  assert.equal(map.size, 1)
})

test('a miss creates and stores; mutating the returned value mutates the stored one', () => {
  const map = new Map()
  const set = getOrCreateBounded(map, 'agent', () => new Set(), 8)
  set.add('skill-x')
  assert.ok(getOrCreateBounded(map, 'agent', () => new Set(), 8).has('skill-x'))
})

test('THE FIX: the Map never exceeds cap; oldest (LRU) entries are evicted', () => {
  const map = new Map()
  for (let i = 0; i < 100; i++) {
    getOrCreateBounded(map, `agent-${i}`, () => new Set([`s${i}`]), 16)
  }
  assert.equal(map.size, 16)
  // the 16 most-recent keys survive; older ones are gone
  assert.ok(map.has('agent-99'))
  assert.ok(map.has('agent-84'))
  assert.ok(!map.has('agent-83'))
  assert.ok(!map.has('agent-0'))
})

test('MRU promotion: a re-accessed key stays warm and survives eviction', () => {
  const map = new Map()
  // the main-thread key
  getOrCreateBounded(map, '', () => new Set(['main']), 8)
  // spawn many subagents, re-touching '' each time (as the main thread does every turn)
  for (let i = 0; i < 50; i++) {
    getOrCreateBounded(map, `sub-${i}`, () => new Set(), 8)
    getOrCreateBounded(map, '', () => new Set(['SHOULD-NOT-RUN']), 8) // hit → promote
  }
  assert.equal(map.size, 8)
  // '' was touched most recently every iteration → never evicted, value intact
  assert.ok(map.has(''))
  assert.deepEqual([...map.get('')], ['main'])
})

test('eviction removes the genuinely-oldest, not a recently-promoted key', () => {
  const map = new Map()
  getOrCreateBounded(map, 'a', () => 1, 3)
  getOrCreateBounded(map, 'b', () => 2, 3)
  getOrCreateBounded(map, 'c', () => 3, 3)
  getOrCreateBounded(map, 'a', () => 99, 3) // promote a (factory must NOT run)
  getOrCreateBounded(map, 'd', () => 4, 3) // overflow → evict oldest, which is now 'b'
  assert.equal(map.size, 3)
  assert.ok(map.has('a')) // promoted → survived
  assert.ok(!map.has('b')) // oldest → evicted
  assert.equal(map.get('a'), 1) // promote did not re-run the factory
})

test('a non-finite or <1 cap disables eviction (grows unbounded)', () => {
  const map = new Map()
  for (let i = 0; i < 20; i++) {
    getOrCreateBounded(map, `k${i}`, () => i, Infinity)
  }
  assert.equal(map.size, 20)
})
