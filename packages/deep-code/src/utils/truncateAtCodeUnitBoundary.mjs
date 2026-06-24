/**
 * Truncate `text` to AT MOST `maxUnits` UTF-16 code units WITHOUT splitting a
 * surrogate pair.
 *
 * A plain `text.slice(0, maxUnits)` / `text.substring(0, maxUnits)` can cut
 * between the high and low halves of an astral character (emoji, many CJK
 * extension chars, etc.), leaving a lone surrogate. That is invalid UTF-16: it
 * renders as a replacement glyph and can corrupt downstream processing (a lone
 * surrogate is not encodable as UTF-8, so a JSON/HTTP layer may replace or
 * reject it). When a code-unit-count limit is used as a content budget, the safe
 * behaviour is to drop the whole astral character rather than half of it.
 *
 * If the boundary would split a pair (the unit at `maxUnits - 1` is a high
 * surrogate and the unit at `maxUnits` is its low surrogate), back off by one
 * code unit so the pair is excluded whole. The result is therefore always
 * `<= maxUnits` code units (the back-off only ever shortens by 1), so it remains
 * a valid upper-bound truncation for any caller using a max-length budget.
 *
 * A surrogate that is ALREADY lone in the input (not part of a valid pair) is
 * preserved as-is — this function avoids CREATING a split, it does not sanitise
 * pre-existing malformed input.
 *
 * @param {string} text
 * @param {number} maxUnits  upper bound in UTF-16 code units
 * @returns {string}
 */
export function truncateAtCodeUnitBoundary(text, maxUnits) {
  if (maxUnits <= 0) return ''
  if (text.length <= maxUnits) return text

  // Would the cut land between the high and low halves of a surrogate pair?
  const lastKept = text.charCodeAt(maxUnits - 1)
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) {
    const firstDropped = text.charCodeAt(maxUnits)
    if (firstDropped >= 0xdc00 && firstDropped <= 0xdfff) {
      return text.slice(0, maxUnits - 1)
    }
  }
  return text.slice(0, maxUnits)
}
