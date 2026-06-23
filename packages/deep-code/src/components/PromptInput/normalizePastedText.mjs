/**
 * Normalize pasted text (after ANSI stripping): collapse line endings to '\n'
 * and expand tabs to 4 spaces.
 *
 * The CR handling must collapse a CRLF PAIR to a single newline. The old
 * `replace(/\r/g, '\n')` mapped every CR independently, so Windows-style CRLF
 * (`\r\n`) became `\n\n` — a blank line between every line — which corrupted the
 * text stored for (and submitted to the model from) the paste, and roughly
 * doubled the "+N lines" label. `\r\n|\r` collapses a CRLF pair and a lone
 * classic-Mac CR to one newline; a lone LF is already correct.
 *
 * @param {string} text  ANSI-stripped pasted text
 * @returns {string}
 */
export function normalizePastedText(text) {
  return text.replace(/\r\n|\r/g, '\n').replaceAll('\t', '    ')
}
