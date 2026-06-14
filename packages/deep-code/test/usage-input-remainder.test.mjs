import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uncachedInputRemainder } from '../src/deepcode/usageInputRemainder.mjs'

test('DeepSeek full prompt with a cache hit -> remainder 0 (no double-count)', () => {
  // prompt_tokens 10 == cache_read 7 + cache_creation 3; everything is cached.
  const r = uncachedInputRemainder({
    promptTokens: 10,
    cacheRead: 7,
    cacheCreation: 3,
  })
  assert.equal(r, 0)
  // The contract: remainder + cache_read + cache_creation == full prompt, so
  // getTokenCountFromUsage's sum equals the true context (no double-count).
  assert.equal(r + 7 + 3, 10)
})

test('DeepSeek all-miss prompt -> remainder 0', () => {
  // prompt_tokens 95 == cache_creation 95, cache_read 0.
  assert.equal(
    uncachedInputRemainder({ promptTokens: 95, cacheRead: 0, cacheCreation: 95 }),
    0,
  )
})

test('Anthropic-shaped input_tokens is already the remainder — trusted verbatim', () => {
  // input_tokens present => Anthropic; do NOT subtract cache (would go negative).
  assert.equal(
    uncachedInputRemainder({
      inputTokens: 5,
      cacheRead: 100,
      cacheCreation: 20,
    }),
    5,
  )
})

test('non-cache turn returns the full prompt unchanged (byte-identical)', () => {
  assert.equal(
    uncachedInputRemainder({ promptTokens: 50, cacheRead: 0, cacheCreation: 0 }),
    50,
  )
  // cache fields entirely absent (non-cache provider)
  assert.equal(uncachedInputRemainder({ promptTokens: 50 }), 50)
})

test('only cache fields known -> whole prompt was cached -> remainder 0', () => {
  assert.equal(uncachedInputRemainder({ cacheRead: 7, cacheCreation: 3 }), 0)
  assert.equal(uncachedInputRemainder({ cacheCreation: 3 }), 0)
})

test('nothing to infer -> undefined (caller keeps prior value)', () => {
  assert.equal(uncachedInputRemainder({}), undefined)
  assert.equal(uncachedInputRemainder(), undefined)
})

test('remainder is never negative (cache exceeds reported prompt)', () => {
  assert.equal(
    uncachedInputRemainder({ promptTokens: 5, cacheRead: 10, cacheCreation: 0 }),
    0,
  )
})

test('a partially-cached full prompt yields the true uncached remainder', () => {
  // A provider that reports a full prompt of 100 with 60 read + 30 created
  // leaves 10 genuinely-uncached tokens.
  const r = uncachedInputRemainder({
    promptTokens: 100,
    cacheRead: 60,
    cacheCreation: 30,
  })
  assert.equal(r, 10)
  assert.equal(r + 60 + 30, 100) // sum reconstructs the full prompt
})

test('non-finite inputs are ignored (NaN/strings do not poison the math)', () => {
  assert.equal(
    uncachedInputRemainder({ promptTokens: 10, cacheRead: Number.NaN, cacheCreation: 3 }),
    7,
  )
  assert.equal(uncachedInputRemainder({ inputTokens: Number.NaN, promptTokens: 8 }), 8)
})
