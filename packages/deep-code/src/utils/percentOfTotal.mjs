/**
 * `part` as a percentage of `total`, guarded against a zero (or non-positive)
 * total so an all-zero data set renders 0% rather than "NaN%"/"Infinity%".
 *
 * The /stats model breakdown sums every model's tokens into `total` and shows
 * each model's share. A session whose only recorded usage is zero-token messages
 * (e.g. errored/refused/empty responses — which the daily-token chart already
 * guards against with its own `if (totalTokens > 0)`) leaves `total === 0` while
 * the model list is non-empty, so the per-model `tokens / total * 100` divided by
 * zero and printed "NaN%". This restores the missing guard consistently. Callers
 * apply their own `.toFixed(1)`.
 *
 * @param {number} part
 * @param {number} total
 * @returns {number} the percentage in [0, 100+], or 0 when total <= 0
 */
export function percentOfTotal(part, total) {
  return total > 0 ? (part / total) * 100 : 0
}
