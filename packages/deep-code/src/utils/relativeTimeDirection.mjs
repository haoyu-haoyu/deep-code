/**
 * Narrow-style label for a relative time of LESS THAN one second.
 *
 * The direction (past vs future) must come from the SIGN of the real
 * millisecond delta. The caller's `Math.trunc(diffInMs / 1000)` collapses any
 * sub-second delta to 0, so a `<= 0` test on it folds a genuinely-future
 * instant (0 < diffInMs < 1000, e.g. a just-written mtime read against a
 * slightly-behind wall clock or cross-machine clock skew) into the past "ago"
 * form. Keying off `diffInMs` keeps this fallback consistent with the signed
 * (`< 0`) branches that handle >= 1s deltas.
 *
 * Exact-now (diffInMs === 0) renders as "in 0s", matching those signed branches
 * which treat a non-negative delta as the future form.
 *
 * @param {number} diffInMs  date.getTime() - now.getTime()
 * @returns {'0s ago' | 'in 0s'}
 */
export function subSecondRelativeNarrow(diffInMs) {
  return diffInMs < 0 ? '0s ago' : 'in 0s'
}
