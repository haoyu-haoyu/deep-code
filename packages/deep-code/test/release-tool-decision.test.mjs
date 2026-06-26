import { test } from 'node:test'
import assert from 'node:assert/strict'

import { releaseToolDecision } from '../src/services/tools/releaseToolDecision.mjs'

test('THE FIX: releases a recorded decision entry (the deny path must not leak it)', () => {
  const m = new Map([['tu_1', { decision: 'reject', source: 'user_reject' }]])
  assert.equal(releaseToolDecision(m, 'tu_1'), true)
  assert.equal(m.has('tu_1'), false)
  assert.equal(m.size, 0)
})

test('no-op (returns false) when the id was never recorded', () => {
  const m = new Map([['tu_other', { decision: 'accept' }]])
  assert.equal(releaseToolDecision(m, 'tu_1'), false)
  assert.equal(m.size, 1)
})

test('safe (returns false) when the toolDecisions map was never created', () => {
  assert.equal(releaseToolDecision(undefined, 'tu_1'), false)
})

test('only the targeted entry is released — sibling tools in a concurrent batch survive', () => {
  const m = new Map([
    ['a', { decision: 'accept' }],
    ['b', { decision: 'reject' }],
    ['c', { decision: 'accept' }],
  ])
  assert.equal(releaseToolDecision(m, 'b'), true)
  assert.deepEqual([...m.keys()], ['a', 'c'])
})

test('idempotent: a second release of the same id is a harmless no-op', () => {
  const m = new Map([['tu_1', { decision: 'reject' }]])
  assert.equal(releaseToolDecision(m, 'tu_1'), true)
  assert.equal(releaseToolDecision(m, 'tu_1'), false)
})
