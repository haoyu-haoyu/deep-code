import { test } from 'node:test'
import assert from 'node:assert/strict'

import { removeElicitationFromQueue } from '../src/utils/mcp/removeElicitationFromQueue.mjs'

const ev = (serverName, requestId) => ({ serverName, requestId, params: {} })

test('removes the entry matching serverName + requestId', () => {
  const queue = [ev('srv', 1), ev('srv', 2)]
  const out = removeElicitationFromQueue(queue, 'srv', 1)
  assert.deepEqual(
    out.map(e => e.requestId),
    [2],
  )
})

test('removes the aborted entry even when it is NOT at the head', () => {
  // The REPL only renders/slices queue[0]; an abort of a non-head entry must
  // remove THAT entry, not the head.
  const queue = [ev('srv', 10), ev('srv', 11), ev('srv', 12)]
  const out = removeElicitationFromQueue(queue, 'srv', 11)
  assert.deepEqual(
    out.map(e => e.requestId),
    [10, 12],
  )
})

test('requires BOTH serverName and requestId to match', () => {
  const queue = [ev('a', 1), ev('b', 1), ev('a', 2)]
  // same requestId (1) but different serverName must be kept
  const out = removeElicitationFromQueue(queue, 'a', 1)
  assert.deepEqual(
    out.map(e => `${e.serverName}:${e.requestId}`),
    ['b:1', 'a:2'],
  )
})

test('matches a numeric requestId strictly (no string coercion)', () => {
  const queue = [ev('srv', 5)]
  // a string "5" must NOT match the numeric 5 (===), so the entry is kept
  assert.equal(removeElicitationFromQueue(queue, 'srv', '5').length, 1)
  // the numeric 5 matches and is removed
  assert.equal(removeElicitationFromQueue(queue, 'srv', 5).length, 0)
})

test('a string requestId is supported', () => {
  const queue = [ev('srv', 'req-abc'), ev('srv', 'req-def')]
  const out = removeElicitationFromQueue(queue, 'srv', 'req-abc')
  assert.deepEqual(
    out.map(e => e.requestId),
    ['req-def'],
  )
})

test('no match leaves every entry (equivalent queue)', () => {
  const queue = [ev('srv', 1), ev('srv', 2)]
  const out = removeElicitationFromQueue(queue, 'srv', 99)
  assert.deepEqual(
    out.map(e => e.requestId),
    [1, 2],
  )
})

test('empty queue stays empty', () => {
  assert.deepEqual(removeElicitationFromQueue([], 'srv', 1), [])
})

test('removes duplicates defensively if the same identity appears twice', () => {
  const queue = [ev('srv', 1), ev('srv', 1)]
  assert.deepEqual(removeElicitationFromQueue(queue, 'srv', 1), [])
})
