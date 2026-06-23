/**
 * Positionally splice a file-completion replacement into the input: replace the
 * partial token occupying [startPos, startPos + partialLength) with
 * replacementText, and report the new cursor position (end of the replacement).
 *
 * This is the single source of truth for both committing the input AND refreshing
 * the suggestion dropdown after a partial-common-prefix Tab. The refresh used to
 * rebuild the search string with `input.replace(token, replacement)`, which
 * replaces the FIRST occurrence of the token text (mis-targeting a duplicate
 * token earlier in the line) and was paired with a STALE cursor offset — so the
 * list re-searched the old short token instead of the just-extended prefix.
 * Splicing at startPos (and deriving the cursor from it) keeps the committed text
 * and the re-search string in agreement.
 *
 * @param {string} input
 * @param {string} replacementText
 * @param {number} startPos        start index of the token being replaced
 * @param {number} partialLength   length of the token being replaced
 * @returns {{ newInput: string, cursorPos: number }}
 */
export function buildFileCompletion(input, replacementText, startPos, partialLength) {
  const newInput =
    input.slice(0, startPos) +
    replacementText +
    input.slice(startPos + partialLength)
  return { newInput, cursorPos: startPos + replacementText.length }
}
