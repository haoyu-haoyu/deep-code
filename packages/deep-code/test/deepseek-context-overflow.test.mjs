import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectDeepSeekContextOverflow,
  formatContextOverflowMessage,
} from '../src/services/runtime/deepSeekContextOverflow.mjs'

const PTL = 'Prompt is too long' // mirrors PROMPT_TOO_LONG_ERROR_MESSAGE (runtime/errors.ts)

test('detects an OpenAI-style context_length_exceeded 400 + extracts tokens', () => {
  const body =
    'DeepSeek API 400: {"error":{"message":"This model\'s maximum context length is 65536 tokens. However, your messages resulted in 70000 tokens. Please reduce the length of the messages.","type":"invalid_request_error","code":"context_length_exceeded"}}'
  assert.deepEqual(detectDeepSeekContextOverflow(body), {
    isOverflow: true,
    actualTokens: 70000,
    limitTokens: 65536,
  })
})

test('detects overflow by the "maximum context length" / "reduce the length" wording', () => {
  assert.equal(
    detectDeepSeekContextOverflow(
      'DeepSeek API 400: maximum context length exceeded',
    ).isOverflow,
    true,
  )
  assert.equal(
    detectDeepSeekContextOverflow(
      'Please reduce the number of tokens in the request',
    ).isOverflow,
    true,
  )
})

test('overflow detected even when token counts are not parseable', () => {
  const r = detectDeepSeekContextOverflow(
    'DeepSeek API 400: {"error":{"code":"context_length_exceeded"}}',
  )
  assert.equal(r.isOverflow, true)
  assert.equal(r.actualTokens, undefined)
  assert.equal(r.limitTokens, undefined)
})

test('does NOT classify an unrelated 400 / other status / empty input', () => {
  assert.equal(
    detectDeepSeekContextOverflow(
      'DeepSeek API 400: {"error":{"message":"invalid tool schema","code":"invalid_request_error"}}',
    ).isOverflow,
    false,
  )
  assert.equal(
    detectDeepSeekContextOverflow('DeepSeek API 429: rate limit').isOverflow,
    false,
  )
  assert.equal(detectDeepSeekContextOverflow('').isOverflow, false)
  assert.equal(detectDeepSeekContextOverflow(undefined).isOverflow, false)
})

test('format: upstream "N tokens > M maximum" shape when both known, bare literal otherwise', () => {
  assert.equal(
    formatContextOverflowMessage({ actualTokens: 70000, limitTokens: 65536 }, PTL),
    'Prompt is too long: 70000 tokens > 65536 maximum',
  )
  assert.equal(formatContextOverflowMessage({ isOverflow: true }, PTL), PTL)
  assert.equal(formatContextOverflowMessage({ actualTokens: 70000 }, PTL), PTL) // only one known
})

test('the formatted message starts with the literal (so isPromptTooLongMessage matches)', () => {
  const m = formatContextOverflowMessage(
    { actualTokens: 70000, limitTokens: 65536 },
    PTL,
  )
  assert.ok(m.startsWith(PTL))
  // and parses back to the upstream token shape
  assert.match(m, /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i)
})
