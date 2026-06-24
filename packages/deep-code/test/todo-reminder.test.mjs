import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildTodoReminderBlock } from '../src/utils/todoReminder.mjs'

test('THE FIX: a single todo is NOT wrapped in stray brackets', () => {
  const block = buildTodoReminderBlock([{ status: 'pending', content: 'Do X' }])
  assert.equal(
    block,
    '\n\nHere are the existing contents of your todo list:\n\n1. [pending] Do X',
  )
  // the regression was a `[` before the first item and `]` after the last
  assert.ok(!block.includes('\n\n[1.'), 'no leading bracket before the list')
  assert.ok(!block.endsWith(']'), 'no trailing bracket after the list')
})

test('multiple todos: a plain numbered list, each item bracketed by status only', () => {
  const block = buildTodoReminderBlock([
    { status: 'completed', content: 'first' },
    { status: 'in_progress', content: 'second' },
    { status: 'pending', content: 'third' },
  ])
  assert.equal(
    block,
    '\n\nHere are the existing contents of your todo list:\n\n' +
      '1. [completed] first\n' +
      '2. [in_progress] second\n' +
      '3. [pending] third',
  )
})

test('the only brackets present are the per-item [status] tags, none wrapping the list', () => {
  const block = buildTodoReminderBlock([
    { status: 'pending', content: 'a' },
    { status: 'pending', content: 'b' },
  ])
  // exactly one [status] per item — 2 items => 2 '[' and 2 ']'
  assert.equal((block.match(/\[/g) || []).length, 2)
  assert.equal((block.match(/\]/g) || []).length, 2)
})

test('an empty todo list yields no block (append is a no-op)', () => {
  assert.equal(buildTodoReminderBlock([]), '')
  assert.equal(buildTodoReminderBlock(undefined), '')
})

test('item content containing brackets is preserved verbatim', () => {
  const block = buildTodoReminderBlock([
    { status: 'pending', content: 'fix array[0] bug' },
  ])
  assert.ok(block.endsWith('1. [pending] fix array[0] bug'))
})
