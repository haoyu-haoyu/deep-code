import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isMaxOutputTokensTruncation,
  isMaxOutputTokensWithheld,
} from '../src/query/maxOutputTokensTruncation.mjs'

test('withheld: only the upstream apiError error-bubble form', () => {
  assert.equal(isMaxOutputTokensWithheld({ apiError: 'max_output_tokens' }), true)
  // DeepSeek real-content truncation is NOT withheld (it streams/persists normally)
  assert.equal(isMaxOutputTokensWithheld({ apiError: undefined }), false)
  assert.equal(isMaxOutputTokensWithheld({}), false)
  assert.equal(isMaxOutputTokensWithheld({ apiError: 'overloaded_error' }), false)
})

test('truncation: detected for BOTH runtime conventions', () => {
  // upstream synthetic error-bubble
  assert.equal(
    isMaxOutputTokensTruncation({ apiError: 'max_output_tokens' }),
    true,
  )
  // DeepSeek: real assistant message, stop_reason 'max_tokens', no apiError
  assert.equal(
    isMaxOutputTokensTruncation({ stopReason: 'max_tokens', hasToolUse: false }),
    true,
  )
})

test('truncation: the DeepSeek bug — stop_reason max_tokens with no apiError still recovers', () => {
  // Before the fix the predicate keyed only on apiError, so this (the real
  // DeepSeek shape) returned false and the whole recovery was dead.
  assert.equal(
    isMaxOutputTokensTruncation({
      apiError: undefined,
      stopReason: 'max_tokens',
      hasToolUse: false,
    }),
    true,
  )
})

test('truncation: a max_tokens cut carrying a (partial) tool_use is NOT text-recoverable', () => {
  // Goes through the tool-execution (needsFollowUp) path, not text recovery.
  assert.equal(
    isMaxOutputTokensTruncation({ stopReason: 'max_tokens', hasToolUse: true }),
    false,
  )
  // ...but the upstream apiError form is still recoverable regardless (it never
  // carries a tool_use anyway).
  assert.equal(
    isMaxOutputTokensTruncation({
      apiError: 'max_output_tokens',
      stopReason: 'max_tokens',
      hasToolUse: true,
    }),
    true,
  )
})

test('truncation: a normal completion is NOT a truncation', () => {
  assert.equal(isMaxOutputTokensTruncation({ stopReason: 'stop' }), false)
  assert.equal(isMaxOutputTokensTruncation({ stopReason: 'end_turn' }), false)
  assert.equal(isMaxOutputTokensTruncation({ stopReason: 'tool_use' }), false)
  assert.equal(isMaxOutputTokensTruncation({ stopReason: null }), false)
  assert.equal(isMaxOutputTokensTruncation({}), false)
})
