import {
  DEEPSEEK_INPUT_PRICING_USD_PER_MILLION,
  estimateDeepSeekCacheSavingsUsd,
  formatUsdEstimate,
} from '../cache/deepseek-pricing.mjs'
import { formatCompactTokenCount } from './cacheStatusChipData.mjs'

// Pure, node-testable per-turn token + cache-savings status for the footer.
//
// Built from the LATEST assistant message's usage (getCurrentUsage) — which
// carries the cache read/creation breakdown directly — so it works even though
// the recordTurn telemetry is gated off for DeepSeek (cache_breakpoint=false).
// It shows this turn's input↑ / output↓ tokens, the input cache hit-rate, and
// the $ SAVED by cache hits. Savings use the EXISTING input-only pricing
// (estimateDeepSeekCacheSavingsUsd), so the number is exact — no DeepSeek output
// price is assumed (the absolute per-turn $ cost is intentionally not shown,
// since output pricing isn't in the repo).

/**
 * @param {{
 *   input_tokens?: number,
 *   output_tokens?: number,
 *   cache_read_input_tokens?: number,
 *   cache_creation_input_tokens?: number,
 * } | null | undefined} usage  the latest turn's usage (e.g. from getCurrentUsage)
 * @param {string} [model]
 * @returns {string|null} a compact status string, or null when there is nothing to show
 */
export function formatTurnTokenStatus({ usage, model = 'deepseek-v4-pro' } = {}) {
  if (!usage) return null
  const input = normalize(usage.input_tokens)
  const output = normalize(usage.output_tokens)
  const cacheRead = normalize(usage.cache_read_input_tokens)
  const cacheCreate = normalize(usage.cache_creation_input_tokens)
  // ↑ falls back to the cache breakdown when a provider omits a top-level input count.
  const inputShown = input || cacheRead + cacheCreate
  if (inputShown === 0 && output === 0) return null

  const parts = [
    `${formatCompactTokenCount(inputShown)}↑`,
    `${formatCompactTokenCount(output)}↓`,
  ]

  const cacheTotal = cacheRead + cacheCreate
  if (cacheTotal > 0) {
    // clamp defensively — read/(read+creation) is always in [0,1] for valid data.
    const hitPct = Math.min(100, Math.max(0, Math.round((cacheRead / cacheTotal) * 100)))
    parts.push(`cache ${hitPct}%`)
  }
  // The savings $ is a DEEPSEEK-only figure: estimateDeepSeekCacheSavingsUsd silently
  // falls back to deepseek-v4-flash pricing for any unrecognized model, so a
  // non-DeepSeek model (gpt-4o / claude-* under a configured provider) would print a
  // misleading DeepSeek-flash-priced "saved" clause. Gate it on a model the pricing
  // table actually knows (the table is the authoritative recognition source — no
  // hardcoded model list to drift); tokens + cache% are still shown for every model.
  // Object.hasOwn (not `in`) so an inherited prototype key ('constructor', 'toString')
  // can't masquerade as a real DeepSeek model.
  if (cacheRead > 0 && Object.hasOwn(DEEPSEEK_INPUT_PRICING_USD_PER_MILLION, model)) {
    // The "~" marks this an ESTIMATE: it's the cache SAVINGS (not the turn cost),
    // computed from the deepseek-pricing.mjs snapshot, which can drift from live
    // pricing (e.g. promo windows) — the same snapshot /cache already uses.
    const saved = estimateDeepSeekCacheSavingsUsd({ hitTokens: cacheRead, model })
    if (saved > 0) parts.push(`saved ~${formatUsdEstimate(saved)}`)
  }
  return parts.join(' · ')
}

function normalize(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * The model that actually produced the latest turn — read from the same last
 * assistant message getCurrentUsage() reads (message.message.model). This is
 * strictly more correct for the savings tier than the session's mainLoopModel:
 * under per-turn routing (--model auto) mainLoopModel is 'auto' (→ flash-pricing
 * fallback), whereas the message carries the resolved model that ran the turn
 * (deepseek-v4-pro vs -flash). Returns undefined when no usage-bearing assistant
 * message exists yet (caller falls back to the session model).
 * @param {ReadonlyArray<any>} messages
 * @returns {string|undefined}
 */
export function latestTurnModel(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m?.type === 'assistant' &&
      m.message &&
      'usage' in m.message &&
      typeof m.message.model === 'string' &&
      m.message.model &&
      // Mirror getTokenUsage()'s SYNTHETIC-SKIP predicate (src/utils/tokens.ts) so
      // this selects the same message getCurrentUsage() does — it skips on EITHER:
      //   (a) the first text block is one of the SYNTHETIC_MESSAGES, OR
      //   (b) model === SYNTHETIC_MODEL.
      // Mirroring only (b) would price a real turn's savings at the wrong tier if a
      // trailing synthetic-MESSAGE assistant record carried a real model. (We also
      // require a truthy model string, so the caller can fall back to the session
      // model when the turn carries none.)
      !(
        m.message.content?.[0]?.type === 'text' &&
        SYNTHETIC_MESSAGES.has(m.message.content[0].text)
      ) &&
      m.message.model !== SYNTHETIC_MODEL
    ) {
      return m.message.model
    }
  }
  return undefined
}

// Mirrors SYNTHETIC_MODEL + SYNTHETIC_MESSAGES in src/utils/messages.ts (a .ts, not
// node-loadable). The cost-status drift-guard test pins these against that source.
const SYNTHETIC_MODEL = '<synthetic>'
const SYNTHETIC_MESSAGES = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
  'No response requested.',
])
