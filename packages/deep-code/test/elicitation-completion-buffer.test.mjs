import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createElicitationCompletionBuffer } from '../src/utils/mcp/elicitationCompletionBuffer.mjs'

test('THE FIX: a completion marked before its entry is consumed when the entry registers', () => {
  const buf = createElicitationCompletionBuffer()
  buf.markCompleted('srv', 'elic-1') // notification arrived during the hooks await
  assert.equal(buf.consumeCompleted('srv', 'elic-1'), true) // entry registers -> born completed
  assert.equal(buf.size(), 0) // consumed
})

test('consume without a prior mark returns false (the normal, no-race path)', () => {
  const buf = createElicitationCompletionBuffer()
  assert.equal(buf.consumeCompleted('srv', 'elic-1'), false)
})

test('a completion is consumed only once', () => {
  const buf = createElicitationCompletionBuffer()
  buf.markCompleted('srv', 'elic-1')
  assert.equal(buf.consumeCompleted('srv', 'elic-1'), true)
  assert.equal(buf.consumeCompleted('srv', 'elic-1'), false)
})

test('keys are scoped per (serverName, elicitationId) — no cross-collision', () => {
  const buf = createElicitationCompletionBuffer()
  buf.markCompleted('srvA', 'elic-1')
  // same id, different server must NOT be consumed by srvA's mark
  assert.equal(buf.consumeCompleted('srvB', 'elic-1'), false)
  // a server name containing the would-be separator can't collide either
  buf.markCompleted('a', 'b","c')
  assert.equal(buf.consumeCompleted('a","b', 'c'), false)
  assert.equal(buf.consumeCompleted('a', 'b","c'), true)
  assert.equal(buf.consumeCompleted('srvA', 'elic-1'), true)
})

test('a null/undefined elicitationId (form-mode elicitation) is a no-op', () => {
  const buf = createElicitationCompletionBuffer()
  buf.markCompleted('srv', undefined)
  buf.markCompleted('srv', null)
  assert.equal(buf.size(), 0)
  assert.equal(buf.consumeCompleted('srv', undefined), false)
  assert.equal(buf.consumeCompleted('srv', null), false)
})

test('bounded: a flood of never-consumed completions evicts oldest-first, stays capped', () => {
  const buf = createElicitationCompletionBuffer(3)
  buf.markCompleted('s', 'a')
  buf.markCompleted('s', 'b')
  buf.markCompleted('s', 'c')
  buf.markCompleted('s', 'd') // evicts 'a'
  assert.equal(buf.size(), 3)
  assert.equal(buf.consumeCompleted('s', 'a'), false) // evicted
  assert.equal(buf.consumeCompleted('s', 'b'), true)
  assert.equal(buf.consumeCompleted('s', 'd'), true)
})

test('re-marking refreshes recency so a repeat is not the eviction victim', () => {
  const buf = createElicitationCompletionBuffer(2)
  buf.markCompleted('s', 'a')
  buf.markCompleted('s', 'b')
  buf.markCompleted('s', 'a') // refresh 'a' -> now 'b' is oldest
  buf.markCompleted('s', 'c') // evicts 'b', not 'a'
  assert.equal(buf.consumeCompleted('s', 'b'), false)
  assert.equal(buf.consumeCompleted('s', 'a'), true)
  assert.equal(buf.consumeCompleted('s', 'c'), true)
})
