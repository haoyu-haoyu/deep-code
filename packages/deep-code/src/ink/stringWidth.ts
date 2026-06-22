import emojiRegex from 'emoji-regex'
import { eastAsianWidth } from 'get-east-asian-width'
import stripAnsi from 'strip-ansi'
import { getGraphemeSegmenter } from '../utils/intl.js'
import { isZeroWidth } from './isZeroWidth.mjs'

const EMOJI_REGEX = emojiRegex()

/**
 * Fallback JavaScript implementation of stringWidth when Bun.stringWidth is not available.
 *
 * Get the display width of a string as it would appear in a terminal.
 *
 * This is a more accurate alternative to the string-width package that correctly handles
 * characters like ⚠ (U+26A0) which string-width incorrectly reports as width 2.
 *
 * The implementation uses eastAsianWidth directly with ambiguousAsWide: false,
 * which correctly treats ambiguous-width characters as narrow (width 1) as
 * recommended by the Unicode standard for Western contexts.
 */
function stringWidthJavaScript(str: string): number {
  if (typeof str !== 'string' || str.length === 0) {
    return 0
  }

  // Fast path: pure ASCII string (no ANSI codes, no wide chars)
  let isPureAscii = true
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // Check for non-ASCII or ANSI escape (0x1b)
    if (code >= 127 || code === 0x1b) {
      isPureAscii = false
      break
    }
  }
  if (isPureAscii) {
    // Count printable characters (exclude control chars)
    let width = 0
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code > 0x1f) {
        width++
      }
    }
    return width
  }

  // Strip ANSI if escape character is present
  if (str.includes('\x1b')) {
    str = stripAnsi(str)
    if (str.length === 0) {
      return 0
    }
  }

  // Fast path: simple Unicode (no emoji, variation selectors, or joiners)
  if (!needsSegmentation(str)) {
    let width = 0
    for (const char of str) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
      }
    }
    return width
  }

  let width = 0

  for (const { segment: grapheme } of getGraphemeSegmenter().segment(str)) {
    // Check for emoji first (most emoji sequences are width 2)
    EMOJI_REGEX.lastIndex = 0
    if (EMOJI_REGEX.test(grapheme)) {
      width += getEmojiWidth(grapheme)
      continue
    }

    // Calculate width for non-emoji graphemes
    // For grapheme clusters (like Devanagari conjuncts with virama+ZWJ), only count
    // the first non-zero-width character's width since the cluster renders as one glyph
    for (const char of grapheme) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
        break
      }
    }
  }

  return width
}

function needsSegmentation(str: string): boolean {
  for (const char of str) {
    const cp = char.codePointAt(0)!
    // Emoji ranges
    if (cp >= 0x1f300 && cp <= 0x1faff) return true
    if (cp >= 0x2600 && cp <= 0x27bf) return true
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true
    // Variation selectors, ZWJ
    if (cp >= 0xfe00 && cp <= 0xfe0f) return true
    if (cp === 0x200d) return true
  }
  return false
}

function getEmojiWidth(grapheme: string): number {
  // Regional indicators: single = 1, pair = 2
  const first = grapheme.codePointAt(0)!
  if (first >= 0x1f1e6 && first <= 0x1f1ff) {
    let count = 0
    for (const _ of grapheme) count++
    return count === 1 ? 1 : 2
  }

  // Incomplete keycap: digit/symbol + VS16 without U+20E3
  if (grapheme.length === 2) {
    const second = grapheme.codePointAt(1)
    if (
      second === 0xfe0f &&
      ((first >= 0x30 && first <= 0x39) || first === 0x23 || first === 0x2a)
    ) {
      return 1
    }
  }

  return 2
}

// Note: complex-script graphemes like Devanagari क्ष (ka+virama+ZWJ+ssa) render
// as a single ligature glyph but occupy 2 terminal cells (wcwidth sums the base
// consonants). Bun.stringWidth=2 matches terminal cell allocation, which is what
// we need for cursor positioning — the JS fallback's grapheme-cluster width of 1
// would desync Ink's layout from the terminal.
//
// Bun.stringWidth is resolved once at module scope rather than checked on every
// call — typeof guards deopt property access and this is a hot path (~100k calls/frame).
const bunStringWidth =
  typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function'
    ? Bun.stringWidth
    : null

const BUN_STRING_WIDTH_OPTS = { ambiguousIsNarrow: true } as const

export const stringWidth: (str: string) => number = bunStringWidth
  ? str => bunStringWidth(str, BUN_STRING_WIDTH_OPTS)
  : stringWidthJavaScript
