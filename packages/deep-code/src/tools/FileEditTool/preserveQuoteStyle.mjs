// The model can only emit straight ASCII quotes (see normalizeQuotes in
// utils.ts), so when old_string matched a file region that uses curly quotes,
// findActualString returns the file's curly text as `actualOldString` while
// `oldString` is the model's straight version — same text, same length, differing
// only in quote glyphs.
//
// preserveQuoteStyle restores the file's curly typography onto new_string. The
// previous implementation curled EVERY straight quote in new_string, which
// silently corrupted code/JSON/shell the model NEWLY wrote (e.g. `--env="prod"`
// -> `--env=”prod”`, a broken flag) whenever the edited region contained a
// curly quote.
//
// The hard part is distinguishing a quote being PRESERVED in place (typography
// to restore) from a quote the model NEWLY introduced (which must stay
// verbatim). A naive "transplant onto the common prefix/suffix" still corrupts,
// because a model-new quote can coincidentally align inside the shared suffix
// (`run "x" now` edited to `run --env="prod" now` -> the closing `"` lands in
// the unchanged ` now` tail). So restore curly quotes ONLY when it is PROVABLY
// safe — when these two conditions both hold:
//   (a) the CHANGED middle of new_string (everything outside the common
//       prefix/suffix it shares with old_string) contains no quote character, and
//   (b) new_string has the SAME number of each quote type as old_string.
// Together these force every quote in new_string to sit at an identical position
// in the common prefix/suffix as a preserved old_string quote — never a
// model-new one — so curling it restores exactly the file's glyph and can never
// corrupt code. (b) without (a) misses re-ordered quotes; (a) without (b) misses
// a removed/added quote whose partner aligns in the tail; both together are
// airtight. When either fails, new_string is returned verbatim (under-curling a
// prose edit is at worst cosmetic; corrupting code is not).

const LEFT_SINGLE = '‘'
const RIGHT_SINGLE = '’'
const LEFT_DOUBLE = '“'
const RIGHT_DOUBLE = '”'

function isCurlyQuote(ch) {
  return (
    ch === LEFT_SINGLE ||
    ch === RIGHT_SINGLE ||
    ch === LEFT_DOUBLE ||
    ch === RIGHT_DOUBLE
  )
}

function countChar(str, ch) {
  let n = 0
  for (let i = 0; i < str.length; i++) if (str[i] === ch) n++
  return n
}

// If the model wrote a straight quote at this aligned position and the file had
// a curly quote there, restore the file's exact curly glyph.
function transplantQuote(out, outIdx, oldChars, fileChars, srcIdx) {
  const modelChar = oldChars[srcIdx]
  const fileChar = fileChars[srcIdx]
  if ((modelChar === '"' || modelChar === "'") && isCurlyQuote(fileChar)) {
    out[outIdx] = fileChar
  }
}

/**
 * @param {string} oldString        the model's (straight-quote) search string
 * @param {string} actualOldString  the file region it matched (may be curly)
 * @param {string} newString        the model's (straight-quote) replacement
 * @returns {string} new_string with the file's curly quotes restored, but only
 *   when doing so is provably safe (see the module comment)
 */
export function preserveQuoteStyle(oldString, actualOldString, newString) {
  // Exact match → no quote normalization happened → nothing to restore.
  if (oldString === actualOldString) return newString
  // findActualString returns a same-length slice; if the lengths ever differ
  // (defensive) the per-position alignment is unsafe — leave new_string as-is.
  if (oldString.length !== actualOldString.length) return newString

  // Condition (b): no quote was added or removed (per type). A mismatch means
  // the model changed the quote structure, so we can't safely map glyphs.
  if (
    countChar(newString, '"') !== countChar(oldString, '"') ||
    countChar(newString, "'") !== countChar(oldString, "'")
  ) {
    return newString
  }

  const out = [...newString]
  const oldChars = [...oldString]
  const fileChars = [...actualOldString]
  const newLen = out.length
  const oldLen = oldChars.length

  // Common prefix / suffix (in code points) shared by new_string and old_string.
  let p = 0
  while (p < newLen && p < oldLen && out[p] === oldChars[p]) p++
  let s = 0
  while (
    s < newLen - p &&
    s < oldLen - p &&
    out[newLen - 1 - s] === oldChars[oldLen - 1 - s]
  ) {
    s++
  }

  // Condition (a): the changed middle of new_string (outside the common
  // prefix/suffix) must contain no quote the model newly wrote.
  for (let i = p; i < newLen - s; i++) {
    if (out[i] === '"' || out[i] === "'") return newString
  }

  // Provably safe: every quote in new_string is a preserved old_string quote at
  // an identical prefix/suffix position. Restore the file's curly glyph at each.
  for (let i = 0; i < p; i++) transplantQuote(out, i, oldChars, fileChars, i)
  for (let i = 0; i < s; i++) {
    transplantQuote(out, newLen - 1 - i, oldChars, fileChars, oldLen - 1 - i)
  }
  return out.join('')
}
