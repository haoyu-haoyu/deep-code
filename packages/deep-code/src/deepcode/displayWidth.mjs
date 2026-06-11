// Terminal-cell display width for the native welcome/picker/status surface.
// CJK/fullwidth/emoji count as 2 cells, combining marks and control chars as 0,
// everything else as 1; ANSI is stripped first. Self-contained (no deps) so it
// stays usable from the dependency-free native path — the chalk/Ink TUI uses the
// richer src/ink/stringWidth.ts instead. The fullwidth ranges and the
// per-code-point loop are ported from the repo's own bundle string-width stub
// (scripts/build-full-cli.mjs), so the cell counts match the shipped bundle.

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

/**
 * Display width of `value` in terminal cells (ANSI stripped first).
 * @param {string} value
 * @returns {number}
 */
export function displayWidth(value) {
  const string = stripAnsi(value)
  let width = 0
  for (let index = 0; index < string.length; index += 1) {
    const codePoint = string.codePointAt(index)
    if (codePoint === undefined) continue
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) continue // control
    if (codePoint >= 0x300 && codePoint <= 0x36f) continue // combining diacriticals
    if (codePoint > 0xffff) index += 1 // surrogate pair consumes two code units
    width += isFullWidthCodePoint(codePoint) ? 2 : 1
  }
  return width
}

/**
 * Longest prefix of `value` (ANSI stripped) whose display width is <= maxWidth,
 * cut on a code-point boundary so a wide char is never split in half.
 * @param {string} value
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateToWidth(value, maxWidth) {
  const string = stripAnsi(value)
  let width = 0
  let result = ''
  for (const char of string) {
    const charWidth = displayWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    result += char
  }
  return result
}
