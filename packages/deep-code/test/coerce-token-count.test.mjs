import assert from 'node:assert/strict'
import { test } from 'node:test'

import { coerceTokenCount } from '../src/services/providers/coerceTokenCount.mjs'
import { mapDeepSeekUsage } from '../src/services/providers/deepseek.mjs'
import { mapOpenAICompatibleUsage } from '../src/services/providers/openai-compatible.mjs'

test('coerceTokenCount: integers pass through, numeric strings are parsed', () => {
  assert.equal(coerceTokenCount(200), 200)
  assert.equal(coerceTokenCount(0), 0)
  assert.equal(coerceTokenCount('200'), 200) // preserve the real count, do not drop
  assert.equal(coerceTokenCount('  200  '), 200)
  assert.equal(coerceTokenCount('2e3'), 2000)
})

test('coerceTokenCount: non-finite / non-numeric fall back to 0 (or the given fallback)', () => {
  for (const v of ['abc', '', NaN, undefined, null, {}, [1, 2], Infinity]) {
    assert.equal(coerceTokenCount(v), 0, `${JSON.stringify(v)} -> 0`)
  }
  assert.equal(coerceTokenCount('abc', 7), 7)
})

test('mapDeepSeekUsage coerces a string token field to a number', () => {
  const mapped = mapDeepSeekUsage({
    prompt_tokens: 1000,
    completion_tokens: '200', // a non-strict gateway emitted a string
    prompt_cache_hit_tokens: 900,
    prompt_cache_miss_tokens: 100,
  })
  assert.equal(mapped.completion_tokens, 200)
  assert.equal(typeof mapped.completion_tokens, 'number')
})

test('mapDeepSeekUsage maps a conformant integer usage byte-identically', () => {
  assert.deepEqual(
    mapDeepSeekUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100,
      total_tokens: 1200,
      completion_tokens_details: { reasoning_tokens: 50 },
    }),
    {
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100,
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      reasoning_tokens: 50,
    },
  )
  // absent fields are still omitted (the conditional-spread shape is preserved)
  assert.deepEqual(mapDeepSeekUsage({ prompt_tokens: 5 }), { prompt_tokens: 5 })
})

test('mapOpenAICompatibleUsage coerces input/output token strings to numbers', () => {
  const mapped = mapOpenAICompatibleUsage({
    prompt_tokens: '1000',
    completion_tokens: '200',
  })
  assert.equal(mapped.input_tokens, 1000)
  assert.equal(mapped.output_tokens, 200)
  // a missing field still resolves to 0 (coerceTokenCount subsumes the old `?? 0`)
  assert.deepEqual(
    {
      input_tokens: mapOpenAICompatibleUsage({}).input_tokens,
      output_tokens: mapOpenAICompatibleUsage({}).output_tokens,
    },
    { input_tokens: 0, output_tokens: 0 },
  )
})

test('REGRESSION: the downstream token sum stays numeric, not a concatenated string', () => {
  // Reproduce getTokenCountFromUsage's `input + cache_creation + cache_read +
  // output` over the per-message usage derived from mapDeepSeekUsage. With the
  // string "200" uncoerced this was 0 + 100 + 900 + "200" => "1000200" (string).
  const m = mapDeepSeekUsage({
    prompt_tokens: 1000,
    completion_tokens: '200',
    prompt_cache_hit_tokens: 900,
    prompt_cache_miss_tokens: 100,
  })
  const cacheRead = m.prompt_cache_hit_tokens
  const cacheCreation = m.prompt_cache_miss_tokens
  const inputRemainder = Math.max(0, m.prompt_tokens - cacheRead - cacheCreation)
  const total = inputRemainder + cacheCreation + cacheRead + m.completion_tokens
  assert.equal(typeof total, 'number')
  assert.equal(total, 1200) // not the string "1000200"
})
