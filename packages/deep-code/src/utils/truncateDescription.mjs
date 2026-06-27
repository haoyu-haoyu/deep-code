import { truncateAtCodeUnitBoundary } from './truncateAtCodeUnitBoundary.mjs'

// A markdown-derived description is capped so it stays short for tool schemas and
// menus. The cap leaves room for the ellipsis: 100 - len('...') = 97.
const MAX_DESCRIPTION_LENGTH = 100
const TRUNCATED_PREFIX_LENGTH = 97
const ELLIPSIS = '...'

/**
 * Cap a description to {@link MAX_DESCRIPTION_LENGTH} UTF-16 code units WITHOUT
 * splitting a surrogate pair.
 *
 * The previous `text.substring(0, 97) + '...'` counts code units, so a cut at 97
 * could land between the high and low halves of an astral character (emoji, many
 * CJK-extension chars) and leave a LONE surrogate. That description is
 * model-facing — it becomes a Command/skill/output-style description that lands
 * in the tool schema sent to the API — and a lone surrogate is invalid UTF-16
 * that the JSON/HTTP layer mangles (replacement glyph) or rejects (the #655 /
 * #666 / #670 truncation family). Routing through truncateAtCodeUnitBoundary
 * drops the whole astral character instead of half of it.
 *
 * For pure-ASCII text this is byte-identical to the old behavior; it only
 * differs when a surrogate pair straddles the 97-unit boundary (then the result
 * is 96 + ellipsis, still <= 100, never a lone surrogate).
 *
 * @param {string} text  the already-extracted, already-trimmed description
 * @returns {string}
 */
export function truncateDescription(text) {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text
  return truncateAtCodeUnitBoundary(text, TRUNCATED_PREFIX_LENGTH) + ELLIPSIS
}
