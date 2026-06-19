import { test } from 'node:test'
import assert from 'node:assert/strict'

import { wouldCreateBlockCycle } from '../src/utils/task/wouldCreateBlockCycle.mjs'

// Build a tasksById map. Each value carries a blockedBy array ("waits for").
const graph = entries => new Map(entries.map(([id, blockedBy]) => [id, { id, blockedBy }]))

// blockTask(from, to) => to.blockedBy += from  (to WAITS FOR from).
// A cycle forms iff `from` already transitively waits for `to`.

test('self-edge is always a cycle (a task cannot wait on itself)', () => {
  assert.equal(wouldCreateBlockCycle('a', 'a', graph([['a', []]])), true)
  // even with an empty/absent map
  assert.equal(wouldCreateBlockCycle('a', 'a', new Map()), true)
})

test('no existing dependency between distinct tasks → no cycle', () => {
  const g = graph([['a', []], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), false)
})

test('direct back-edge is a cycle', () => {
  // from(a) already waits for to(b): a.blockedBy = [b]. Adding b waits-for a closes a↔b.
  const g = graph([['a', ['b']], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), true)
})

test('transitive back-edge is a cycle', () => {
  // a waits-for x, x waits-for b. Adding b waits-for a closes a→x→b→a.
  const g = graph([['a', ['x']], ['x', ['b']], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), true)
})

test('a longer chain that does NOT reach `to` → no cycle', () => {
  // a waits-for x, x waits-for y; `b` is unreachable from a.
  const g = graph([['a', ['x']], ['x', ['y']], ['y', []], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), false)
})

test('dangling blockedBy id (deleted blocker) terminates the branch, no cycle', () => {
  const g = graph([['a', ['ghost']], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), false)
})

test('shared diamond dependency does not loop forever and is not a false cycle', () => {
  // a waits-for {p,q}; p,q both wait-for r; r terminal. Adding b waits-for a.
  const g = graph([['a', ['p', 'q']], ['p', ['r']], ['q', ['r']], ['r', []], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), false)
})

test('a pre-existing cycle elsewhere does not cause an infinite loop', () => {
  // m↔n already cyclic; checking an unrelated edge must terminate via the seen-set.
  const g = graph([['m', ['n']], ['n', ['m']], ['a', []], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), false)
})

test('reaching `to` deep in a shared graph is detected', () => {
  // a → p → r → b ; adding b waits-for a closes the loop through the shared node r.
  const g = graph([['a', ['p']], ['p', ['r']], ['r', ['b']], ['b', []]])
  assert.equal(wouldCreateBlockCycle('a', 'b', g), true)
})

test('a node with undefined blockedBy is tolerated', () => {
  const m = new Map([['a', { id: 'a' }], ['b', { id: 'b', blockedBy: [] }]])
  assert.equal(wouldCreateBlockCycle('a', 'b', m), false)
})
