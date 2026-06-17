import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectRestoredTodos } from '../src/utils/todo/restoreScan.mjs'

const TODO = 'TodoWrite'

// A block carries its parse outcome in `input` so the fake parser is trivial:
//   { ok: true, todos } -> a successfully-parsed (already collapsed) list
//   { ok: false }       -> a malformed / schema-invalid block
const ok = todos => ({ ok: true, todos })
const bad = () => ({ ok: false })
const parse = input => input
const block = (name, input) => ({ name, input })

test('no TodoWrite block -> empty list', () => {
  assert.deepEqual(selectRestoredTodos([], TODO, parse), [])
  assert.deepEqual(
    selectRestoredTodos([block('Other', ok(['x']))], TODO, parse),
    [],
  )
})

test('S22-5: within one turn the LAST TodoWrite wins (not the first)', () => {
  // A turn issuing two TodoWrite calls runs them serially, last-wins.
  const blocks = [block(TODO, ok(['first'])), block(TODO, ok(['last']))]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['last'])
})

test('newest-first across turns: the most recent valid list wins', () => {
  const blocks = [block(TODO, ok(['old'])), block(TODO, ok(['new']))]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['new'])
})

test('S22-6: a malformed most-recent TodoWrite falls back to an earlier valid list', () => {
  // The malformed call errored live (is_error tool_result) without mutating
  // state, so the list the session held is the earlier valid one — NOT [].
  const blocks = [block(TODO, ok(['valid'])), block(TODO, bad())]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['valid'])
})

test('within-turn [valid, malformed]: the valid same-turn block still wins', () => {
  // This is the case a naive findLast-then-skip would mishandle (it would skip
  // the whole turn). The valid earlier block in the SAME turn reflects live
  // state, so it must win.
  const blocks = [block(TODO, ok(['kept'])), block(TODO, bad())]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['kept'])
})

test('within-turn [malformed, valid]: the valid later block wins', () => {
  const blocks = [block(TODO, bad()), block(TODO, ok(['applied']))]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['applied'])
})

test('a successful parse that collapsed to [] wins and stops the scan (preserves resume-collapse)', () => {
  // A fully-completed list collapses to [] live; resuming must NOT resurrect an
  // earlier non-empty list, so the collapsed-empty success wins over older work.
  const blocks = [block(TODO, ok(['earlier'])), block(TODO, ok([]))]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), [])
})

test('all TodoWrite blocks malformed -> empty list', () => {
  const blocks = [block(TODO, bad()), block(TODO, bad())]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), [])
})

test('non-TodoWrite tool_use blocks are skipped, not parsed', () => {
  // A foreign tool's input must never be treated as a todo list.
  const blocks = [
    block('Other', ok(['should-not-appear'])),
    block(TODO, ok(['real'])),
    block('Other', ok(['also-not'])),
  ]
  assert.deepEqual(selectRestoredTodos(blocks, TODO, parse), ['real'])
})
