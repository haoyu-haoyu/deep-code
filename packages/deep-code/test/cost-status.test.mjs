import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatTurnTokenStatus,
  latestTurnModel,
} from '../src/components/costStatusData.mjs'

// ── per-turn token + cache-savings status (footer chip data) ─────────────────
// Built from the latest turn's usage (the cache breakdown is in the message
// usage, so it works without the gated recordTurn telemetry). Shows input↑ /
// output↓ tokens, this turn's input cache hit-rate, and the $ saved by cache
// hits (exact — uses the existing input-only pricing; no output price assumed).

test('a warm turn shows tokens, cache hit-rate, and cache savings', () => {
  const s = formatTurnTokenStatus({
    usage: {
      input_tokens: 12000,
      output_tokens: 567,
      cache_read_input_tokens: 11160, // 93% of 12000
      cache_creation_input_tokens: 840,
    },
    model: 'deepseek-v4-pro',
  })
  assert.match(s, /^12k↑ · 567↓ · cache 93% · saved ~\$/)
})

test('a cold turn (no cache hits) shows tokens + 0% and NO savings', () => {
  const s = formatTurnTokenStatus({
    usage: {
      input_tokens: 2000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 2000,
    },
    model: 'deepseek-v4-flash',
  })
  assert.equal(s, '2k↑ · 100↓ · cache 0%')
})

test('compact K/M formatting for large counts', () => {
  const s = formatTurnTokenStatus({
    usage: {
      input_tokens: 1_500_000,
      output_tokens: 12_345,
      cache_read_input_tokens: 1_485_000,
      cache_creation_input_tokens: 15_000,
    },
    model: 'deepseek-v4-pro',
  })
  assert.match(s, /^1\.5M↑ · 12\.3k↓ · cache 99% · saved ~\$/)
})

test('savings appear only when there are cache-read tokens', () => {
  // cache hits → savings present
  assert.match(
    formatTurnTokenStatus({
      usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    }),
    / · saved ~\$/,
  )
  // no cache section at all when there's no cache breakdown
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: 500, output_tokens: 20 } }),
    '500↑ · 20↓',
  )
})

test('the cache hit-rate uses read / (read + creation)', () => {
  const s = formatTurnTokenStatus({
    usage: { input_tokens: 400, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 300 },
  })
  assert.match(s, /cache 25%/) // 100 / 400
})

test('an all-cache-hit turn shows cache 100% (and the rate is clamped to [0,100])', () => {
  const s = formatTurnTokenStatus({
    usage: { input_tokens: 5000, output_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
  })
  assert.match(s, /cache 100%/)
})

test('input↑ falls back to the cache breakdown when input_tokens is absent', () => {
  const s = formatTurnTokenStatus({
    usage: { output_tokens: 5, cache_read_input_tokens: 700, cache_creation_input_tokens: 300 },
  })
  assert.match(s, /^1k↑ · 5↓ · cache 70%/) // 700 + 300
})

test('null / empty / non-positive usage yields null', () => {
  assert.equal(formatTurnTokenStatus({ usage: null }), null)
  assert.equal(formatTurnTokenStatus({ usage: undefined }), null)
  assert.equal(formatTurnTokenStatus({}), null)
  assert.equal(formatTurnTokenStatus({ usage: { input_tokens: 0, output_tokens: 0 } }), null)
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: -5, output_tokens: NaN } }),
    null,
  )
})

test('an unknown model falls back to a known pricing tier (no throw, savings still computed)', () => {
  const s = formatTurnTokenStatus({
    usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    model: 'some-unknown-model',
  })
  assert.match(s, / · saved ~\$/)
})

// ── latestTurnModel: the per-turn model for the correct pricing tier ─────────
// Fixes the Codex finding: the chip previously priced savings with the session
// mainLoopModel (which is 'auto' under per-turn routing → flash fallback). The
// model that actually ran the turn lives on its assistant message.

const A = (model, usage) => ({ type: 'assistant', message: { model, usage, content: [] } })
const U = text => ({ type: 'user', message: { content: text } })

test('latestTurnModel reads the model off the last usage-bearing assistant message', () => {
  const messages = [
    U('hi'),
    A('deepseek-v4-flash', { input_tokens: 10, output_tokens: 5 }),
    U('go pro'),
    A('deepseek-v4-pro', { input_tokens: 9000, output_tokens: 40 }), // last turn ran pro
  ]
  assert.equal(latestTurnModel(messages), 'deepseek-v4-pro')
})

test('latestTurnModel skips user messages + assistant messages without usage', () => {
  const messages = [
    A('deepseek-v4-pro', { input_tokens: 5, output_tokens: 1 }),
    A('deepseek-v4-flash', {}), // no usage keys present? still has 'usage' → counts; use a real no-usage case:
    { type: 'assistant', message: { model: 'x', content: [] } }, // no usage → skipped
    U('hello'), // user → skipped
  ]
  assert.equal(latestTurnModel(messages), 'deepseek-v4-flash')
})

test('latestTurnModel returns undefined for an empty / assistant-less history', () => {
  assert.equal(latestTurnModel([]), undefined)
  assert.equal(latestTurnModel([U('a'), U('b')]), undefined)
  assert.equal(latestTurnModel(undefined), undefined)
})

test('the per-turn model fixes auto-mode pricing: a pro turn prices at the pro tier', () => {
  // Same hit tokens; pro-tier savings must be ~3x the flash fallback.
  const proSaved = formatTurnTokenStatus({
    usage: { input_tokens: 100000, output_tokens: 10, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 },
    model: 'deepseek-v4-pro',
  })
  const flashSaved = formatTurnTokenStatus({
    usage: { input_tokens: 100000, output_tokens: 10, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 },
    model: 'deepseek-v4-flash',
  })
  // extract the "~$x" amounts and assert pro > flash (different tiers, not collapsed)
  const amt = s => Number(s.match(/saved ~\$([0-9.]+)/)[1])
  assert.ok(amt(proSaved) > amt(flashSaved) * 2, `pro ${amt(proSaved)} should be >2x flash ${amt(flashSaved)}`)
})

test('latestTurnModel skips synthetic messages (matches getCurrentUsage selection)', () => {
  // a synthetic assistant message (model '<synthetic>') after a real pro turn
  // must NOT become the pricing model — getCurrentUsage skips it too.
  const messages = [
    U('do it'),
    A('deepseek-v4-pro', { input_tokens: 50000, output_tokens: 30, cache_read_input_tokens: 40000, cache_creation_input_tokens: 10000 }),
    A('<synthetic>', { input_tokens: 0, output_tokens: 0 }), // e.g. an interrupt marker
  ]
  assert.equal(latestTurnModel(messages), 'deepseek-v4-pro')
})
