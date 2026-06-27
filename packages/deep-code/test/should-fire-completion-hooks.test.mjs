import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldFireCompletionHooks } from '../src/tools/TaskUpdateTool/shouldFireCompletionHooks.mjs'

test('fires when the live task is not already completed', () => {
  assert.equal(shouldFireCompletionHooks('pending'), true)
  assert.equal(shouldFireCompletionHooks('in_progress'), true)
})

test('THE FIX: does NOT fire when the live task is already completed', () => {
  // A concurrent update won and completed the task while this call held a stale
  // "pending" snapshot — re-running the blocking hooks would be a double-fire.
  assert.equal(shouldFireCompletionHooks('completed'), false)
})
