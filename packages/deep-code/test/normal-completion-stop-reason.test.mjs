import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNormalCompletionStopReason } from '../src/utils/normalCompletionStopReason.mjs'

test('the two "completed normally" markers — both runtimes', () => {
  // Anthropic
  assert.equal(isNormalCompletionStopReason('end_turn'), true)
  // DeepSeek / OpenAI-compatible (the bug: only 'end_turn' was accepted before,
  // so a normal DeepSeek completion mapped to 'stop' was treated as an error)
  assert.equal(isNormalCompletionStopReason('stop'), true)
})

test('NOT a normal completion: pending tool call / truncation', () => {
  assert.equal(isNormalCompletionStopReason('tool_use'), false)
  assert.equal(isNormalCompletionStopReason('max_tokens'), false)
})

test('NOT a clean normal completion: filtered / unknown / missing', () => {
  assert.equal(isNormalCompletionStopReason('content_filter'), false)
  assert.equal(isNormalCompletionStopReason(null), false)
  assert.equal(isNormalCompletionStopReason(undefined), false)
  assert.equal(isNormalCompletionStopReason(''), false)
})
