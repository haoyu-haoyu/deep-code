// The model can only emit straight ASCII quotes (see normalizeQuotes in
// utils.ts), so when old_string matched a file region that uses curly quotes,
// findActualString returns the file's curly text as `actualOldString` while
// `oldString` is the model's straight version — same text, same length, differing
// only in quote glyphs.
//
// preserveQuoteStyle restores the file's curly typography onto new_string. The
// previous implementation curled EVERY straight quote in new_string via an
// open/close heuristic, which silently corrupted code/JSON/shell the model
// newly wrote (e.g. `--env="prod"` -> `--env=”prod”`, a broken flag) whenever
// the edited file region happened to contain a curly quote.
//
// Instead, transplant the file's actual curly glyph onto ONLY the parts of
// new_string that are UNCHANGED from old_string — the common prefix and suffix.
// Quotes in the changed middle (everything the model rewrote) keep the model's
// straight style, so newly-written code/JSON/CLI is never curled. This both
// fixes the corruption and uses the file's real left/right curly choice at each
// preserved position instead of guessing.

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
 * @returns {string} new_string with the file's curly quotes restored only on
 *   the regions unchanged from old_string
 */
export function preserveQuoteStyle(oldString, actualOldString, newString) {
  // Exact match → no quote normalization happened → nothing to restore.
  if (oldString === actualOldString) return newString
  // findActualString returns a same-length slice; if the lengths ever differ
  // (defensive) the per-position alignment is unsafe — leave new_string as-is.
  if (oldString.length !== actualOldString.length) return newString

  const out = [...newString]
  const oldChars = [...oldString]
  const fileChars = [...actualOldString]
  const newLen = out.length
  const oldLen = oldChars.length

  // Common prefix: positions identical in new_string and old_string from the
  // start. (Read out[p] BEFORE transplanting so the comparison sees the model's
  // original character.)
  let p = 0
  while (p < newLen && p < oldLen && out[p] === oldChars[p]) {
    transplantQuote(out, p, oldChars, fileChars, p)
    p++
  }

  // Common suffix: positions identical from the end, not overlapping the prefix.
  let s = 0
  while (
    s < newLen - p &&
    s < oldLen - p &&
    out[newLen - 1 - s] === oldChars[oldLen - 1 - s]
  ) {
    transplantQuote(out, newLen - 1 - s, oldChars, fileChars, oldLen - 1 - s)
    s++
  }

  return out.join('')
}
