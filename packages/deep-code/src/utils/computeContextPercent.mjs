/**
 * Context-window usage as an integer percentage, rounded and clamped to [0, 100].
 *
 * Shared by the StatusLine (calculateContextPercentages) and the /context view
 * (analyzeContextUsage) so both report the SAME number for the same usage. The
 * /context headline previously omitted the clamp, so when the last response's
 * context momentarily exceeded the window (at/just before autocompact, or with a
 * stale/overridden window) it printed e.g. "105%" while the status line showed a
 * clamped "100%" for identical input.
 *
 * Mirrors the StatusLine's existing round-then-clamp exactly (no divide-by-zero
 * guard added, to stay byte-identical to that path).
 *
 * @param {number} totalTokens    input + cache_creation + cache_read tokens
 * @param {number} contextWindow  model context window size
 * @returns {number} integer in [0, 100]
 */
export function computeContextPercent(totalTokens, contextWindow) {
  return Math.min(
    100,
    Math.max(0, Math.round((totalTokens / contextWindow) * 100)),
  )
}
