// Terminal-cell display width for the native welcome/picker/status surface.
// CJK/fullwidth/emoji count as 2 cells, combining marks and control chars as 0,
// everything else as 1; ANSI is stripped first. The zero-width test is shared
// with the Ink TUI via the dependency-free src/ink/isZeroWidth.mjs leaf (the only
// import — no heavy deps) so the native path and the TUI agree on which code
// points occupy no cells; the chalk/Ink TUI uses the richer src/ink/stringWidth.ts
// for the rest. The fullwidth ranges and the per-code-point loop are ported from
// the repo's own bundle string-width stub (scripts/build-full-cli.mjs).

import { isZeroWidth } from '../ink/isZeroWidth.mjs'

// The canonical ansi-regex (strip-ansi) pattern — the repo's bundle string-width
// stub is a simplified copy of it. Strips CSI *and* OSC sequences, including
// OSC-8 hyperlinks whose URL payload contains '/', ':', '?', etc. (the stub's
// narrower OSC param class leaves those partially un-stripped). Built via
// new RegExp from a string so the ESC/BEL bytes stay \u-escaped (no literal
// control bytes in source) and '/' needs no escaping.
const ANSI_RE = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
)

function stripAnsi(value) {
  return String(value ?? '').replace(ANSI_RE, '')
}

function isFullWidthCodePoint(codePoint) {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f || // Hangul Jamo
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) || // CJK..Yi
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical forms
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK Compatibility Forms
      (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth Forms
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || // Emoji
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || // Supplemental Symbols
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)) // CJK Ext B+
  )
}

// True iff the string carries any code point the per-code-point loop measures wrong
// (emoji, regional indicator, variation selector, ZWJ). With none present, the
// original loop is exact, so non-emoji input takes the fast path at zero cost.
function needsSegmentation(string) {
  for (const ch of string) {
    const cp = ch.codePointAt(0)
    if (cp >= 0x1f300 && cp <= 0x1faff) return true // pictographic emoji
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true // regional indicators (flags)
    if (cp >= 0xfe00 && cp <= 0xfe0f) return true // variation selectors (incl. VS16)
    if (cp === 0x200d) return true // ZWJ
    // NOTE: the misc-symbols block U+2600-U+27BF is deliberately NOT a trigger: those
    // code points default to TEXT presentation (width 1) and the original loop already
    // counts them as 1. A VS16-qualified one (e.g. ❤️ = U+2764 U+FE0F) still segments
    // via the U+FE0F trigger above and renders as the width-2 emoji.
  }
  return false
}

let graphemeSegmenter
function getGraphemeSegmenter() {
  // Intl.Segmenter is a JS built-in (no npm dep) — keeps this leaf self-contained.
  return (graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' }))
}

function clusterIsEmoji(grapheme) {
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)
    // Pictographic, regional indicator, or explicitly emoji-presentation (VS16).
    // A bare U+2600-U+27BF symbol is NOT treated as emoji (text presentation, w1);
    // a VS16 anywhere in the cluster promotes it to the width-2 emoji form.
    if (
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
      cp === 0xfe0f
    ) {
      return true
    }
  }
  return false
}

// Terminal cells for one emoji grapheme (mirrors src/ink/stringWidth.ts
// getEmojiWidth): most are 2; a LONE regional indicator is 1; a digit/#/* followed
// by VS16 without the keycap combiner renders as the plain char (1).
function emojiClusterWidth(grapheme) {
  const first = grapheme.codePointAt(0)
  if (first >= 0x1f1e6 && first <= 0x1f1ff) {
    let count = 0
    for (const _ of grapheme) count += 1
    return count === 1 ? 1 : 2
  }
  // base + VS16 with no further combiner: an ASCII base (a digit/#/* "incomplete
  // keycap", or any other printable ASCII glued to an orphan VS16) has no emoji
  // form, so it renders as the plain width-1 char — not a width-2 emoji. A
  // non-ASCII base (❤ U+2764, ⚠ U+26A0, ™ U+2122 …) does have an emoji form → 2.
  if (grapheme.length === 2) {
    const second = grapheme.codePointAt(1)
    if (second === 0xfe0f && first >= 0x20 && first < 0x7f) {
      return 1
    }
  }
  return 2
}

function clusterWidth(grapheme) {
  if (clusterIsEmoji(grapheme)) return emojiClusterWidth(grapheme)
  // Non-emoji cluster (base + combining marks) renders as one glyph: the width of
  // its first non-zero-width code point. (Skin-tone modifiers never reach here —
  // a cluster containing one is classified emoji above.)
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)
    if (!isZeroWidth(cp)) return isFullWidthCodePoint(cp) ? 2 : 1
  }
  return 0
}

/**
 * Display width of `value` in terminal cells (ANSI stripped first).
 * @param {string} value
 * @returns {number}
 */
export function displayWidth(value) {
  const string = stripAnsi(value)
  // Emoji / variation-selector / ZWJ present → segment by grapheme and count one
  // cell-group per cluster (invisible joiners/selectors/modifiers add 0, an emoji
  // cluster is 2). This is what no longer over-counts ZWJ family sequences, keycaps,
  // skin-tone modifiers, etc., and no longer under-counts emoji outside the two
  // narrow fullwidth ranges.
  if (needsSegmentation(string)) {
    let width = 0
    for (const { segment } of getGraphemeSegmenter().segment(string)) {
      width += clusterWidth(segment)
    }
    return width
  }
  // Fast path: no emoji/VS/ZWJ. Same shared isZeroWidth test as the cluster path,
  // so a Thai/Arabic/Indic/bidi combining mark (not just U+0300–U+036F) and an
  // astral zero-width code point count as 0 cells here too. The surrogate-pair
  // advance happens BEFORE the skip so a zero-width astral code point (a
  // supplementary variation selector or tag char) still consumes both code units.
  let width = 0
  for (let index = 0; index < string.length; index += 1) {
    const codePoint = string.codePointAt(index)
    if (codePoint === undefined) continue
    if (codePoint > 0xffff) index += 1 // surrogate pair consumes two code units
    if (isZeroWidth(codePoint)) continue
    width += isFullWidthCodePoint(codePoint) ? 2 : 1
  }
  return width
}

/**
 * Longest prefix of `value` (ANSI stripped) whose display width is <= maxWidth,
 * cut on a GRAPHEME-CLUSTER boundary so neither a wide char nor a multi-code-point
 * glyph (a ZWJ emoji family, a base+combining-mark, a skin-tone-modified emoji) is
 * ever split in half. Iterating by code point would stop mid-cluster — e.g.
 * truncating 👨‍👩‍👧 (man ZWJ woman ZWJ girl) to width 3 would keep "man + ZWJ" and
 * emit a dangling U+200D joiner.
 * @param {string} value
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateToWidth(value, maxWidth) {
  const string = stripAnsi(value)
  let width = 0
  let result = ''
  for (const { segment } of getGraphemeSegmenter().segment(string)) {
    const segmentWidth = displayWidth(segment)
    if (width + segmentWidth > maxWidth) break
    width += segmentWidth
    result += segment
  }
  return result
}
