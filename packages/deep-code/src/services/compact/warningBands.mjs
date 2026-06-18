// Window-scaled "context low" warning/error display bands for autocompact.
//
// The warning + error bands are subtracted from the autocompact threshold to
// decide when the TUI shows the "context low" WARNING and the stronger ERROR
// state. They used to be fixed 20k absolutes — a sane ~10% on the legacy ~200k
// window, but only ~2% of a 1M DeepSeek window, so the warning appeared only ~20k
// before autocompact (useless) AND warning == error (both 20k). Scale them to the
// EFFECTIVE context window (the src/utils/toolSearch.ts `Math.floor(window*pct)`
// idiom) with a 20k floor so:
//   - a large window gets a useful early warning, with warning > error > floor, and
//   - the legacy ~200k window stays EXACTLY 20k (byte-identical back-compat: the
//     floor wins whenever effective <= floor/fraction, i.e. <= ~200k for warning).
// These feed DISPLAY-ONLY flags (isAboveWarning/ErrorThreshold). The autocompact
// TRIGGER (autoCompactThreshold) and the manual-compact blocking limit are NOT
// scaled — only the two display bands move.

// Matches the legacy fixed band; the floor keeps small windows unchanged.
export const WARNING_BAND_FLOOR_TOKENS = 20_000
// Warning fires earlier (a bigger band) than error; error sits closer to the
// threshold (the more urgent state). On a small window both floor to 20k (== today).
const WARNING_BAND_FRACTION = 0.1
const ERROR_BAND_FRACTION = 0.06

function scaleBand(effectiveContextWindow, fraction) {
  const window = Number(effectiveContextWindow)
  if (!Number.isFinite(window) || window <= 0) return WARNING_BAND_FLOOR_TOKENS
  return Math.max(WARNING_BAND_FLOOR_TOKENS, Math.floor(window * fraction))
}

/** Tokens below the threshold at which the "context low" WARNING shows. */
export function warningBandTokens(effectiveContextWindow) {
  return scaleBand(effectiveContextWindow, WARNING_BAND_FRACTION)
}

/**
 * Tokens below the threshold at which the stronger ERROR state shows. A smaller
 * band than the warning, so error sits closer to the autocompact threshold.
 */
export function errorBandTokens(effectiveContextWindow) {
  return scaleBand(effectiveContextWindow, ERROR_BAND_FRACTION)
}
