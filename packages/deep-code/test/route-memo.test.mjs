import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  contentToText,
  extractLatestUserMessage,
  getMemoizedRoute,
  setMemoizedRoute,
  clearRouteMemo,
} from '../src/services/autoMode/routeMemo.mjs'

beforeEach(() => clearRouteMemo())

// --- extractLatestUserMessage (the task-boundary key) ------------------------

test('contentToText reduces string / text-block array / other to text', () => {
  assert.equal(contentToText('hi'), 'hi')
  assert.equal(contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(contentToText([{ type: 'tool_result', content: 'x' }]), '', 'tool_result blocks have no text')
  assert.equal(contentToText(undefined), '')
})

test('returns the latest user TEXT message, scanning from the end', () => {
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ]
  assert.equal(extractLatestUserMessage(messages), 'second')
})

test('CORE PROPERTY: a tool-loop continuation keeps the SAME task key as the prompt turn', () => {
  // The prompt turn:
  const promptTurn = [{ role: 'user', content: 'do the task' }]
  // A continuation appends an assistant tool-call turn + a tool_result user message
  // (which carries NO text) — the latest human message is still "do the task".
  const continuation = [
    { role: 'user', content: 'do the task' },
    { role: 'assistant', content: [{ type: 'text', text: 'calling a tool' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] },
  ]
  assert.equal(extractLatestUserMessage(promptTurn), 'do the task')
  assert.equal(
    extractLatestUserMessage(continuation),
    'do the task',
    'continuation skips the tool_result user message → same task key',
  )
  // A genuinely new prompt yields a different key.
  const newPrompt = [...continuation, { role: 'user', content: 'now do something else' }]
  assert.equal(extractLatestUserMessage(newPrompt), 'now do something else')
})

test('no user text → empty key (stable)', () => {
  assert.equal(extractLatestUserMessage([{ role: 'assistant', content: 'x' }]), '')
  assert.equal(extractLatestUserMessage([]), '')
})

// --- the memo ----------------------------------------------------------------

const route = m => ({ model: m, thinking: 'enabled', reasoningEffort: 'high' })

test('memo: set/get round-trip; miss returns null', () => {
  assert.equal(getMemoizedRoute('task A'), null)
  setMemoizedRoute('task A', route('pro'))
  assert.deepEqual(getMemoizedRoute('task A'), route('pro'))
  assert.equal(getMemoizedRoute('task B'), null)
})

test('memo: a continuation reuses the route; a new task misses (end-to-end key+memo)', () => {
  const keyA = extractLatestUserMessage([{ role: 'user', content: 'task A' }])
  setMemoizedRoute(keyA, route('flash'))
  // continuation → same key → hit
  const contKey = extractLatestUserMessage([
    { role: 'user', content: 'task A' },
    { role: 'assistant', content: [{ type: 'text', text: '...' }] },
    { role: 'user', content: [{ type: 'tool_result', content: 'r' }] },
  ])
  assert.deepEqual(getMemoizedRoute(contKey), route('flash'), 'continuation reuses task A route (no re-route)')
  // new prompt → different key → miss → would re-route
  const newKey = extractLatestUserMessage([{ role: 'user', content: 'task B' }])
  assert.equal(getMemoizedRoute(newKey), null)
})

test('memo: empty-key tasks are memoizable and stable', () => {
  setMemoizedRoute('', route('pro'))
  assert.deepEqual(getMemoizedRoute(''), route('pro'))
})

test('memo: LRU-bounded — the oldest task evicts past the cap', () => {
  for (let i = 0; i < 20; i++) setMemoizedRoute(`task ${i}`, route(`m${i}`))
  assert.equal(getMemoizedRoute('task 0'), null, 'oldest evicted')
  assert.deepEqual(getMemoizedRoute('task 19'), route('m19'), 'most-recent retained')
})

test('memo: re-setting a key refreshes its recency (not evicted as oldest)', () => {
  for (let i = 0; i < 16; i++) setMemoizedRoute(`t${i}`, route(`m${i}`))
  setMemoizedRoute('t0', route('m0-refreshed')) // refresh t0 → now most-recent
  setMemoizedRoute('t16', route('m16')) // pushes out the now-oldest (t1, not t0)
  assert.deepEqual(getMemoizedRoute('t0'), route('m0-refreshed'), 'refreshed key survived')
  assert.equal(getMemoizedRoute('t1'), null, 't1 was the oldest and evicted')
})

test('clearRouteMemo drops everything', () => {
  setMemoizedRoute('task A', route('pro'))
  clearRouteMemo()
  assert.equal(getMemoizedRoute('task A'), null)
})
