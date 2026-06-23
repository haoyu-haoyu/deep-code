/**
 * Find the start index, in `beforeCursor`, of the last shell token (the one being
 * completed) when its raw text differs from its parsed value — i.e. quoting or
 * escaping is present, e.g. `cat my\ fil` whose last token VALUE is "my fil" but
 * whose RAW text "my\ fil" starts earlier than a naive lastIndexOf(' ') would find.
 *
 * The boundary is computed with shell-quote ITSELF (via the injected tryParse), so
 * there is no separate tokenizer to drift from the library: it returns the LARGEST
 * index s such that (a) beforeCursor.slice(s) parses to exactly the single token
 * `resolvedPrefix` AND (b) s is a real token boundary — index 0, or preceded by
 * whitespace or a shell operator char. Condition (b) rejects a non-boundary slice
 * that coincidentally re-parses to the same value because shell-quote tolerates a
 * trailing unmatched quote (e.g. `na\"me"` inside `"na\"me"`).
 *
 * Used only when the raw suffix differs from the parsed prefix (quoting present);
 * the naive lastIndexOf(' ')+1 then lands on a literal space INSIDE the token and
 * duplicates the earlier fragment.
 *
 * @param {string} beforeCursor
 * @param {string} resolvedPrefix  the parsed value of the last token
 * @param {(s: string) => { success: boolean, tokens?: unknown[] }} tryParse
 * @returns {number} the raw token start offset
 */
export function quotedTokenStart(beforeCursor, resolvedPrefix, tryParse) {
  // The raw (quoted/escaped) token is never shorter than its parsed value, so its
  // start can be at most beforeCursor.length - resolvedPrefix.length.
  for (let s = beforeCursor.length - resolvedPrefix.length; s >= 0; s--) {
    if (s !== 0 && !isTokenSeparator(beforeCursor[s - 1])) continue
    const r = tryParse(beforeCursor.slice(s))
    if (
      r &&
      r.success &&
      Array.isArray(r.tokens) &&
      r.tokens.length === 1 &&
      r.tokens[0] === resolvedPrefix
    ) {
      return s
    }
  }
  // Defensive fallback (should not be reached for a well-formed quoted token).
  return Math.max(0, beforeCursor.length - resolvedPrefix.length)
}

/** Whether `ch` separates shell tokens (whitespace or an unquoted operator char). */
function isTokenSeparator(ch) {
  return ch === undefined || /[\s|&;<>()]/.test(ch)
}

/**
 * Shell-escape a file/dir completion's display text so a path containing spaces
 * (or other shell metacharacters) stays a single argument when the command runs.
 *
 * compgen appends a trailing SPACE to a file (a token separator, kept outside the
 * quotes) and a trailing SLASH to a directory (part of the path, kept inside).
 * `quoteFn` is shell-quote's quote, which is a no-op for names without special
 * characters — so a clean completion is byte-identical to the old raw insert.
 *
 * @param {string} displayText  raw compgen completion (e.g. "my file.txt " or "dir/")
 * @param {(args: string[]) => string} quoteFn
 * @returns {string}
 */
export function escapeFileCompletion(displayText, quoteFn) {
  if (displayText.endsWith(' ')) {
    return quoteFn([displayText.slice(0, -1)]) + ' '
  }
  return quoteFn([displayText])
}
