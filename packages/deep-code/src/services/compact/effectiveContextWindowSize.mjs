// The effective context window must stay comfortably above the compaction
// buffers so the autocompact threshold (effective - AUTOCOMPACT_BUFFER_TOKENS,
// 13k) and the manual-compact blocking limit (effective - MANUAL_COMPACT_BUFFER_
// TOKENS, 3k) stay POSITIVE. If the effective window goes negative, every
// threshold comparison inverts — `tokenUsage >= <negative>` is always true — so
// the session bricks: it reports "over the limit" and blocks every turn, and
// percentLeft displays values above 100%. 20k keeps both thresholds positive
// with headroom and equals the summary reservation magnitude.
export const MIN_EFFECTIVE_CONTEXT_WINDOW = 20_000

/**
 * Pure core of getEffectiveContextWindowSize: apply the optional
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW override, subtract the summary reservation, and
 * FLOOR the result so the downstream threshold math can never go negative.
 *
 * A real model context window minus the ~20k reservation is far above the floor,
 * so this is a no-op for normal use. The floor only engages when an override (or
 * a pathologically small window) would otherwise drive the effective window
 * negative — there, a tiny window simply yields very aggressive (but working)
 * compaction instead of an unusable, always-blocked session.
 *
 * @param {number} contextWindow  the model's context window
 * @param {number} reservedTokensForSummary  tokens reserved for the summary output
 * @param {string|undefined} autoCompactWindowEnv  raw CLAUDE_CODE_AUTO_COMPACT_WINDOW value
 * @returns {number} the effective window, always >= MIN_EFFECTIVE_CONTEXT_WINDOW
 */
export function effectiveContextWindowSize(
  contextWindow,
  reservedTokensForSummary,
  autoCompactWindowEnv,
) {
  let window = contextWindow
  if (autoCompactWindowEnv) {
    const parsed = parseInt(autoCompactWindowEnv, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      window = Math.min(window, parsed)
    }
  }
  return Math.max(MIN_EFFECTIVE_CONTEXT_WINDOW, window - reservedTokensForSummary)
}
