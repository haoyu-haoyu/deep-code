// Single source of truth for mapping a requested effort to the DeepSeek
// `reasoning_effort` wire value.
//
// The deepseek-v4 API accepts a GRADED effort enum (probe-confirmed against the
// live endpoint — an unknown variant 400s with: "expected one of `high`, `low`,
// `medium`, `max`, `xhigh`"), and the tiers are behaviorally distinct: on a fixed
// task the reasoning depth grows roughly low < medium < high < max < xhigh, with
// max ~5.5K reasoning tokens and xhigh ~11K (about 2x max).
//
// DeepCode previously collapsed this to just {high, max} in TWO places
// (deepseek.mjs and query/deepseek-call-model.mjs), which silently UPGRADED
// low/medium to high (wasting tokens/latency when the caller wanted a cheaper
// pass) and DOWNGRADED xhigh to max (unreachable deepest tier). Pass the server's
// real enum through instead. Unrecognized values still fall back to 'high' (the
// prior safe behavior), and the cache-prefix-stable default is preserved by the
// caller's `unset` choice (an unset effort still resolves to 'max' at the request
// builder, so the default request stays byte-identical).
export const DEEPSEEK_REASONING_EFFORTS = Object.freeze([
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
])

const DEEPSEEK_EFFORT_SET = new Set(DEEPSEEK_REASONING_EFFORTS)

/**
 * Coerce an arbitrary requested effort to a server-valid tier.
 * @param {unknown} value
 * @param {{ unset?: string | undefined, fallback?: string }} [opts]
 *   unset    — returned for a nullish value (the request builder uses 'max' to
 *              preserve the default; the per-call pre-normalizer uses undefined
 *              so the `??` chain can fall through).
 *   fallback — returned for a non-nullish but unrecognized value (default 'high').
 * @returns {string | undefined}
 */
export function coerceDeepSeekEffort(value, opts = {}) {
  if (value === undefined || value === null) {
    // Use `'unset' in opts` (not a destructuring default) so an EXPLICIT
    // `{ unset: undefined }` is honored — the per-call pre-normalizer must be
    // able to return undefined so resolveDeepSeekConfig's `??` chain falls
    // through to env/file/default rather than short-circuiting on a literal.
    return 'unset' in opts ? opts.unset : 'max'
  }
  const normalized = String(value).toLowerCase()
  if (DEEPSEEK_EFFORT_SET.has(normalized)) return normalized
  return opts.fallback ?? 'high'
}
