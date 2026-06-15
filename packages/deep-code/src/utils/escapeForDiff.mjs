// The diff library mishandles raw `&` and `$` (they are regex-replacement special
// characters — `$&`, `$1` — and the lib substitutes them when building patches),
// so content is escaped before diffing and un-escaped on the resulting hunk lines.
//
// The previous escape mapped `&` / `$` to the fixed sentinels `<<:AMPERSAND_TOKEN:>>`
// / `<<:DOLLAR_TOKEN:>>` and reversed them blindly — NOT a bijection: any content
// that already contained a literal sentinel was folded to `&` / `$` on the way out,
// corrupting the diff and (via getPatchFromContents → getEditsForPatch) the
// reconstructed edit. The sentinel even appears in this repo's own source.
//
// Make it a true bijection with a single-character escape lead (a private-use
// codepoint, which the diff library treats as ordinary text). The lead is escaped
// FIRST, so no input — including one already containing the lead or the old
// sentinels — can collide with an inserted escape. The escaped form contains no
// `&` / `$`, so the diff library never sees them. Built from a char code so no
// literal private-use byte appears in source.
const DIFF_ESCAPE_LEAD = String.fromCharCode(0xe000)
const ESCAPED_AMPERSAND = DIFF_ESCAPE_LEAD + 'A'
const ESCAPED_DOLLAR = DIFF_ESCAPE_LEAD + 'D'

export function escapeForDiff(s) {
  return s
    .replaceAll(DIFF_ESCAPE_LEAD, DIFF_ESCAPE_LEAD + DIFF_ESCAPE_LEAD)
    .replaceAll('&', ESCAPED_AMPERSAND)
    .replaceAll('$', ESCAPED_DOLLAR)
}

export function unescapeFromDiff(s) {
  // The lead only ever appears as the first half of an inserted escape pair, so a
  // single left-to-right scan is an exact inverse.
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === DIFF_ESCAPE_LEAD && i + 1 < s.length) {
      const next = s[i + 1]
      if (next === 'A') {
        out += '&'
        i++
        continue
      }
      if (next === 'D') {
        out += '$'
        i++
        continue
      }
      if (next === DIFF_ESCAPE_LEAD) {
        out += DIFF_ESCAPE_LEAD
        i++
        continue
      }
    }
    out += s[i]
  }
  return out
}
