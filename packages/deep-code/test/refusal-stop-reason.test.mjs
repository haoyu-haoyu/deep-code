import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isRefusalStopReason } from '../src/utils/refusalStopReason.mjs'
import { isNormalCompletionStopReason } from '../src/utils/normalCompletionStopReason.mjs'

test('refusal markers — DeepSeek content_filter and Anthropic/ACP refusal', () => {
  assert.equal(isRefusalStopReason('content_filter'), true)
  assert.equal(isRefusalStopReason('refusal'), true)
})

test('a server capacity failure is NOT a refusal (stays an error)', () => {
  // insufficient_system_resource is a mid-generation server failure, not a
  // deliberate refusal — it must keep surfacing as an error.
  assert.equal(isRefusalStopReason('insufficient_system_resource'), false)
})

test('normal completions and pending/lost reasons are NOT refusals', () => {
  for (const r of [
    'stop',
    'end_turn',
    'tool_use',
    'max_tokens',
    'unknown',
    null,
    undefined,
    '',
  ]) {
    assert.equal(isRefusalStopReason(r), false, `${JSON.stringify(r)} is not a refusal`)
  }
})

test('the content-free terminal carve-out accepts normal completion OR refusal', () => {
  // Mirrors isResultSuccessful (queryHelpers.ts): a content-free terminal turn is
  // a clean (non-error) result iff it ended normally OR is a refusal.
  const accepted = stopReason =>
    isNormalCompletionStopReason(stopReason) || isRefusalStopReason(stopReason)

  // clean terminals (no spurious error_during_execution)
  for (const r of ['stop', 'end_turn', 'content_filter', 'refusal']) {
    assert.equal(accepted(r), true, `${r} should be a clean terminal`)
  }
  // still an error: capacity failure, truncation, pending tool call, lost/absent
  for (const r of [
    'insufficient_system_resource',
    'max_tokens',
    'tool_use',
    'unknown',
    null,
    undefined,
    '',
  ]) {
    assert.equal(accepted(r), false, `${JSON.stringify(r)} should NOT be a clean terminal`)
  }
})
