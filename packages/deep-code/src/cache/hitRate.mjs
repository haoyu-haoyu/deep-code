// Cache hit RATIO = hit / (hit + miss), and 0 when there are no tokens (avoids 0/0 = NaN).
// Single source for the three places that computed it with byte-identical inline copies —
// the public DeepSeek diagnostics rate (calculateDeepSeekCacheHitRate), the per-/total-
// request stats (calculateHitRate), and the persisted telemetry rate (cacheHitRate). The
// telemetry copy additionally rounds to 4 dp; it now wraps this ratio with an explicit
// toFixed, so the rounding is visibly a presentation choice rather than a divergent
// reimplementation that could silently drift from the others.
export function cacheHitRatio(hit, miss) {
  const total = hit + miss
  return total === 0 ? 0 : hit / total
}
