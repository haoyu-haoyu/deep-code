import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatTurnTokenStatus,
  latestTurnModel,
} from '../src/components/costStatusData.mjs'
import { budgetEnforceabilityWarning } from '../src/utils/budgetEnforceabilityWarning.mjs'

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

test('a NON-DeepSeek / unknown model omits the savings clause (no misleading flash-priced $)', () => {
  // The savings $ is DeepSeek-only (estimateDeepSeekCacheSavingsUsd falls back to
  // flash pricing for unknown models). A non-DeepSeek model must NOT print a
  // flash-priced "saved" clause — tokens + cache% are still shown.
  const usage = { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }
  for (const model of ['some-unknown-model', 'gpt-4o', 'claude-sonnet-4-20250514', 'auto', 'llama3.1:70b']) {
    const s = formatTurnTokenStatus({ usage, model })
    assert.doesNotMatch(s, / · saved ~\$/, `${model} must not show savings`)
    assert.match(s, /cache 100%/, `${model} still shows tokens + cache%`)
  }
  // recognized DeepSeek models (and the default) still show savings
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    assert.match(formatTurnTokenStatus({ usage, model }), / · saved ~\$/, `${model} shows savings`)
  }
  assert.match(formatTurnTokenStatus({ usage }), / · saved ~\$/, 'default model shows savings')
  // an inherited prototype key must NOT masquerade as a real model (Object.hasOwn,
  // not `in`) — else it would slip past the gate and compute a NaN-priced clause.
  for (const protoKey of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.doesNotMatch(formatTurnTokenStatus({ usage, model: protoKey }), / · saved ~\$/, `${protoKey} must not enable savings`)
  }
})

// ── reasoning_tokens: the per-turn reasoning breakdown of output↓ ────────────
// DeepSeek bills reasoning inside completion_tokens, so reasoning_tokens is a
// SUBSET of output_tokens. The chip shows it as its own segment (display only),
// never adding it to the ↑/↓ counts.

test('a reasoning turn shows the reasoning segment right after output↓', () => {
  const s = formatTurnTokenStatus({
    usage: {
      input_tokens: 12000,
      output_tokens: 5500,
      reasoning_tokens: 5200, // of the 5.5k output, 5.2k was reasoning
      cache_read_input_tokens: 11160,
      cache_creation_input_tokens: 840,
    },
    model: 'deepseek-v4-pro',
  })
  assert.match(s, /^12k↑ · 5\.5k↓ · 5\.2k reasoning · cache 93% · saved ~\$/)
})

test('reasoning is omitted when the turn did not reason (0 / absent)', () => {
  // absent → no segment (and exact format is unchanged from before this feature)
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: 500, output_tokens: 20 } }),
    '500↑ · 20↓',
  )
  // explicit 0 → no segment
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: 500, output_tokens: 20, reasoning_tokens: 0 } }),
    '500↑ · 20↓',
  )
  // a non-positive / NaN reasoning count is treated as absent (normalize guard)
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: 500, output_tokens: 20, reasoning_tokens: -3 } }),
    '500↑ · 20↓',
  )
  assert.equal(
    formatTurnTokenStatus({ usage: { input_tokens: 500, output_tokens: 20, reasoning_tokens: NaN } }),
    '500↑ · 20↓',
  )
})

test('reasoning is display-only: it never inflates the ↑/↓ token counts', () => {
  // identical input/output, with and without a reasoning breakdown → the ↑ and ↓
  // numbers are byte-identical; only an extra segment is appended.
  const base = { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 }
  const without = formatTurnTokenStatus({ usage: base, model: 'deepseek-v4-flash' })
  const withR = formatTurnTokenStatus({ usage: { ...base, reasoning_tokens: 600 }, model: 'deepseek-v4-flash' })
  assert.equal(without, '2k↑ · 800↓ · cache 0%')
  assert.equal(withR, '2k↑ · 800↓ · 600 reasoning · cache 0%')
})

test('reasoning count uses the same compact K/M formatting', () => {
  const s = formatTurnTokenStatus({
    usage: { input_tokens: 50000, output_tokens: 23456, reasoning_tokens: 21000 },
  })
  assert.match(s, /· 21k reasoning/)
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

// a synthetic MESSAGE carrying a REAL model — getTokenUsage skips on the FIRST
// TEXT BLOCK too, not only on model===SYNTHETIC_MODEL. latestTurnModel must mirror
// BOTH or it would price the real turn's usage at the wrong tier.
const Atext = (model, firstText) => ({
  type: 'assistant',
  message: { model, usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: firstText }] },
})

test('latestTurnModel skips a synthetic-MESSAGE assistant even when it carries a real model (GAP 2)', () => {
  for (const synthetic of [
    '[Request interrupted by user]',
    '[Request interrupted by user for tool use]',
    'No response requested.',
    "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
  ]) {
    const messages = [
      Atext('deepseek-v4-pro', 'the real turn output'), // the real, usage-bearing turn
      Atext('deepseek-v4-flash', synthetic), // a synthetic marker that (in theory) carries a real model
    ]
    assert.equal(latestTurnModel(messages), 'deepseek-v4-pro', `skip synthetic: ${synthetic.slice(0, 30)}`)
  }
  // a GENUINE trailing answer (not a synthetic string) is still used
  assert.equal(
    latestTurnModel([Atext('deepseek-v4-pro', 'first'), Atext('deepseek-v4-flash', 'a real answer')]),
    'deepseek-v4-flash',
  )
})

// ── budgetEnforceabilityWarning: --max-budget-usd unenforceable for unpriced models ──
// A --max-budget-usd cap can only fire if the active model has USD pricing. This
// DeepSeek fork prices DeepSeek input-only, so the cap would silently never
// trigger for a DeepSeek model. The leaf decides whether to warn (and builds the
// message); it does NOT invent a price or revive cost tracking.

test('no budget set → no warning (null)', () => {
  assert.equal(budgetEnforceabilityWarning(undefined, false, 'deepseek-v4-pro'), null)
  assert.equal(budgetEnforceabilityWarning(null, false, 'deepseek-v4-pro'), null)
})

test('priceable model → no warning even with a budget (its cap could fire)', () => {
  assert.equal(budgetEnforceabilityWarning(5, true, 'claude-opus-4-6'), null)
  assert.equal(budgetEnforceabilityWarning(0.01, true, 'claude-sonnet-4-6'), null)
})

test('budget set + unpriceable model → a loud warning naming the model and amount', () => {
  const w = budgetEnforceabilityWarning(2.5, false, 'deepseek-v4-pro')
  assert.ok(typeof w === 'string')
  assert.match(w, /will NOT be enforced/)
  assert.match(w, /\$2\.5\b/) // the budget amount is shown
  assert.match(w, /deepseek-v4-pro/) // the offending model is named
})

test('the warning fires for any unpriceable model id (auto, unknown)', () => {
  for (const model of ['deepseek-v4-flash', 'auto', 'some-unknown-model']) {
    assert.match(budgetEnforceabilityWarning(10, false, model), /will NOT be enforced/, model)
  }
})

// DRIFT GUARD: the SYNTHETIC_MODEL + SYNTHETIC_MESSAGES mirrored in
// costStatusData.mjs (a .mjs that can't import the bun-tainted messages.ts) must
// stay byte-equal to the source constants, or the synthetic-skip predicate
// silently diverges from getTokenUsage.
test('costStatusData mirrors SYNTHETIC_MODEL + SYNTHETIC_MESSAGES from messages.ts (drift guard)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const messagesSrc = readFileSync(resolve(here, '..', 'src/utils/messages.ts'), 'utf8')
  const costSrc = readFileSync(resolve(here, '..', 'src/components/costStatusData.mjs'), 'utf8')

  // SYNTHETIC_MODEL value from source
  const modelLit = messagesSrc.match(/export const SYNTHETIC_MODEL\s*=\s*('[^']*'|"[^"]*")/)
  assert.ok(modelLit, 'SYNTHETIC_MODEL must be a string literal in messages.ts')
  assert.ok(costSrc.includes(`SYNTHETIC_MODEL = ${modelLit[1]}`), 'costStatusData must mirror SYNTHETIC_MODEL')

  // the 5 SYNTHETIC_MESSAGES members (constant NAMES → their string values), each
  // must appear verbatim in costStatusData's mirrored Set.
  const memberNames = ['INTERRUPT_MESSAGE', 'INTERRUPT_MESSAGE_FOR_TOOL_USE', 'CANCEL_MESSAGE', 'REJECT_MESSAGE', 'NO_RESPONSE_REQUESTED']
  for (const name of memberNames) {
    const lit = messagesSrc.match(new RegExp(`export const ${name}\\s*=\\s*('[^']*'|"[^"]*")`))
    assert.ok(lit, `${name} must be a single-line string literal in messages.ts`)
    const value = lit[1].slice(1, -1) // strip quotes
    assert.ok(
      costSrc.includes(value),
      `costStatusData.mjs must mirror ${name} verbatim (drift): ${value.slice(0, 40)}…`,
    )
  }
})
