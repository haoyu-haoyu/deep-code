import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allTodosCompleted,
  collapseCompletedTodos,
} from '../src/utils/todo/completion.mjs'

const todo = (status, content = status) => ({ content, activeForm: content, status })

// --- allTodosCompleted -----------------------------------------------------

test('allTodosCompleted is true only when every item is completed', () => {
  assert.equal(allTodosCompleted([todo('completed'), todo('completed')]), true)
  assert.equal(allTodosCompleted([todo('completed'), todo('pending')]), false)
  assert.equal(allTodosCompleted([todo('completed'), todo('in_progress')]), false)
  assert.equal(allTodosCompleted([todo('pending')]), false)
  // Empty list: every() is vacuously true — matches the tool's todos.every check.
  assert.equal(allTodosCompleted([]), true)
})

// --- collapseCompletedTodos ------------------------------------------------

test('collapseCompletedTodos clears a fully-completed list and preserves any other', () => {
  // Fully completed -> [] (mirrors TodoWriteTool.call: a finished list is cleared).
  assert.deepEqual(collapseCompletedTodos([todo('completed'), todo('completed')]), [])
  assert.deepEqual(collapseCompletedTodos([todo('completed')]), [])
  assert.deepEqual(collapseCompletedTodos([]), [])

  // Any unfinished item -> the list survives unchanged (same reference).
  const partial = [todo('completed'), todo('in_progress'), todo('pending')]
  assert.equal(collapseCompletedTodos(partial), partial)
  const oneOpen = [todo('pending')]
  assert.equal(collapseCompletedTodos(oneOpen), oneOpen)
})

// --- the --resume bug it fixes ---------------------------------------------

test('resume scenario: a transcript all-completed list collapses to the cleared live state', () => {
  // The live TodoWrite call set app state to [] once everything was completed,
  // but the transcript still holds the model's raw full input. Restoring must
  // apply the same collapse, not resurrect the finished list.
  const transcriptInputTodos = [
    todo('completed', 'build leaf'),
    todo('completed', 'wire tool'),
    todo('completed', 'add tests'),
  ]
  assert.deepEqual(collapseCompletedTodos(transcriptInputTodos), [])

  // A session interrupted mid-work (not all completed) DOES restore its list.
  const midWork = [
    todo('completed', 'build leaf'),
    todo('in_progress', 'wire tool'),
    todo('pending', 'add tests'),
  ]
  assert.equal(collapseCompletedTodos(midWork), midWork)
  assert.equal(collapseCompletedTodos(midWork).length, 3)
})
