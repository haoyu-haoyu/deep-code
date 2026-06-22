/**
 * Whether a code point occupies zero terminal cells.
 *
 * This MUST agree with the line-wrap function the TUI actually uses (npm
 * wrap-ansi v9 -> string-width v7, which treats every Unicode
 * Default_Ignorable_Code_Point as width 0). If stringWidth counts a code point
 * that wrap-ansi treats as zero-width, the cursor/viewport math (MeasuredText
 * column positions, getOffsetFromPosition, up/down) drifts relative to where the
 * terminal actually wraps — e.g. ~half a column per bidirectional mark in pasted
 * RTL/mixed text.
 *
 * Pure numeric predicate (no allocation, no regex) because it is on the
 * stringWidth hot path (~100k calls/frame); the ASCII fast path returns before
 * reaching here.
 *
 * @param {number} codePoint
 * @returns {boolean}
 */
export function isZeroWidth(codePoint) {
  // Fast path for common printable range
  if (codePoint >= 0x20 && codePoint < 0x7f) return false
  if (codePoint >= 0xa0 && codePoint < 0x0300) return codePoint === 0x00ad

  // Control characters
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true

  // Bidirectional / explicit-formatting controls + zero-width / invisible
  // characters. These are Default_Ignorable, so the wrap function counts them as
  // width 0; the bidi controls (LRM/RLM, isolates, ALM, the LRE/RLE/PDF/LRO/RLO
  // embeddings) are routinely embedded in text copied from browsers/chat apps.
  if (
    codePoint === 0x061c || // Arabic letter mark (ALM)
    (codePoint >= 0x200b && codePoint <= 0x200f) || // ZW space/joiner + LRM/RLM
    (codePoint >= 0x202a && codePoint <= 0x202e) || // LRE/RLE/PDF/LRO/RLO
    codePoint === 0xfeff || // BOM / ZW no-break space
    (codePoint >= 0x2060 && codePoint <= 0x206f) // word joiner, isolates (LRI/RLI/FSI/PDI), deprecated formats
  ) {
    return true
  }

  // Variation selectors
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return true
  }

  // Combining diacritical marks
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return true
  }

  // Indic script combining marks (covers Devanagari through Malayalam)
  if (codePoint >= 0x0900 && codePoint <= 0x0d4f) {
    // Signs and vowel marks at start of each script block
    const offset = codePoint & 0x7f
    if (offset <= 0x03) return true // Signs at block start
    if (offset >= 0x3a && offset <= 0x4f) return true // Vowel signs, virama
    if (offset >= 0x51 && offset <= 0x57) return true // Stress signs
    if (offset >= 0x62 && offset <= 0x63) return true // Vowel signs
  }

  // Thai/Lao combining marks
  // Note: U+0E32 (SARA AA), U+0E33 (SARA AM), U+0EB2, U+0EB3 are spacing vowels (width 1), not combining marks
  if (
    codePoint === 0x0e31 || // Thai MAI HAN-AKAT
    (codePoint >= 0x0e34 && codePoint <= 0x0e3a) || // Thai vowel signs (skip U+0E32, U+0E33)
    (codePoint >= 0x0e47 && codePoint <= 0x0e4e) || // Thai vowel signs and marks
    codePoint === 0x0eb1 || // Lao MAI KAN
    (codePoint >= 0x0eb4 && codePoint <= 0x0ebc) || // Lao vowel signs (skip U+0EB2, U+0EB3)
    (codePoint >= 0x0ec8 && codePoint <= 0x0ecd) // Lao tone marks
  ) {
    return true
  }

  // Arabic formatting
  if (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    codePoint === 0x08e2
  ) {
    return true
  }

  // Surrogates, tag characters
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true

  return false
}
