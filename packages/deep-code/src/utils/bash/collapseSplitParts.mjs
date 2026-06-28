/**
 * Collapse shell-quote's flat token stream (the output of `parse()`) into the
 * command-boundary-delimited "parts" array consumed by splitCommandWithOperators:
 * adjacent bareword strings merge into one command, a glob token folds onto the
 * preceding command, an unquoted newline becomes a `null` command boundary, and
 * operators/comments pass through as their own entries.
 *
 * SECURITY — newline boundary. An unquoted `\n` is pre-tokenized (in
 * splitCommandWithOperators) to a salted standalone NEW_LINE placeholder so
 * shell-quote, which drops bare newlines, still surfaces it as a token. Such a
 * standalone token is ALWAYS a command boundary, regardless of what precedes it.
 *
 * The bug this fixes: the `push(null)` boundary used to be NESTED under the
 * "previous part is a string" guard. So the SECOND of two consecutive newlines
 * (its predecessor is the `null` pushed by the first), or a LEADING newline
 * (no predecessor / an operator), failed that guard and fell through to
 * `parts.push(part)` — leaking the literal `__NEW_LINE_<salt>__` token, which
 * then merged with the following command into e.g. `__NEW_LINE_<salt>__ rm -rf /`.
 * Because the salt is random per parse, no `Bash(rm:*)` deny (or any) rule could
 * ever match that subcommand, so a denied command hidden after a blank line (or
 * a leading blank line) silently bypassed the deny matcher. Treating a standalone
 * NEW_LINE token as a boundary unconditionally closes that gap.
 *
 * A standalone NEW_LINE token only ever originates from an UNQUOTED `\n`; a
 * newline inside quotes stays embedded within its string token (with the
 * surrounding `\n` markers) and is restored by a later replaceAll, so this never
 * mis-splits quoted text.
 *
 * Pure: tokens in, parts out. `parsed` entries are shell-quote ParseEntry values
 * (a bareword `string`, or an object with `op`/`pattern`/`comment`).
 *
 * @param {Array<string | object>} parsed  shell-quote parse() output
 * @param {string} newLinePlaceholder  placeholders.NEW_LINE for this parse
 * @returns {Array<string | null | object>} the collapsed parts (nulls = boundaries)
 */
export function collapseSplitParts(parsed, newLinePlaceholder) {
  const parts = []
  for (const part of parsed) {
    if (typeof part === 'string') {
      if (part === newLinePlaceholder) {
        // Unconditional command boundary (see the SECURITY note above).
        parts.push(null)
        continue
      }
      if (parts.length > 0 && typeof parts[parts.length - 1] === 'string') {
        parts[parts.length - 1] += ' ' + part
        continue
      }
    } else if (
      part !== null &&
      typeof part === 'object' &&
      'op' in part &&
      part.op === 'glob'
    ) {
      // Fold a glob onto the preceding command (e.g. `ls` + `*.txt`).
      if (parts.length > 0 && typeof parts[parts.length - 1] === 'string') {
        parts[parts.length - 1] += ' ' + part.pattern
        continue
      }
    }
    parts.push(part)
  }
  return parts
}
