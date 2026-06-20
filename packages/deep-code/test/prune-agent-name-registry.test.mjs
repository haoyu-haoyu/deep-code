import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pruneAgentNameRegistry } from '../src/utils/task/pruneAgentNameRegistry.mjs'

const reg = entries => new Map(entries)

test('removes the name entry for an evicted agent id', () => {
  const r = reg([['alice', 'a1'], ['bob', 'a2']])
  const out = pruneAgentNameRegistry(r, ['a1'])
  assert.deepEqual([...out], [['bob', 'a2']])
})

test('removes ALL names pointing at an evicted id', () => {
  const r = reg([['alice', 'a1'], ['ali', 'a1'], ['bob', 'a2']])
  const out = pruneAgentNameRegistry(r, ['a1'])
  assert.deepEqual([...out], [['bob', 'a2']])
})

test('keeps live agents and prunes multiple evicted ids at once', () => {
  const r = reg([['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']])
  const out = pruneAgentNameRegistry(r, ['2', '4'])
  assert.deepEqual(
    [...out].map(([n]) => n),
    ['a', 'c'],
  )
})

test('no matching eviction returns the SAME map reference (referential stability)', () => {
  const r = reg([['alice', 'a1']])
  assert.equal(pruneAgentNameRegistry(r, ['nope']), r)
})

test('empty eviction list returns the same reference', () => {
  const r = reg([['alice', 'a1']])
  assert.equal(pruneAgentNameRegistry(r, []), r)
})

test('a match returns a NEW map (does not mutate the input)', () => {
  const r = reg([['alice', 'a1'], ['bob', 'a2']])
  const out = pruneAgentNameRegistry(r, ['a1'])
  assert.notEqual(out, r)
  assert.equal(r.size, 2) // input untouched
  assert.equal(out.size, 1)
})

test('accepts a Set of evicted ids', () => {
  const r = reg([['alice', 'a1'], ['bob', 'a2']])
  const out = pruneAgentNameRegistry(r, new Set(['a2']))
  assert.deepEqual([...out], [['alice', 'a1']])
})

test('empty registry stays empty', () => {
  const r = reg([])
  assert.equal(pruneAgentNameRegistry(r, ['a1']), r)
})
