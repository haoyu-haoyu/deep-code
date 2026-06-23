/**
 * Truncate a line-numbered diff snippet to a length cap, appending an accurate
 * "[N lines truncated]" footer. Returns `full` unchanged when it already fits.
 *
 * Counting the hidden lines depends on WHERE the cut lands:
 *
 *  - At a line boundary (the common case — we cut at the last '\n' that fits):
 *    `kept` ends just before that boundary newline, so a count of newlines from
 *    kept.length INCLUDES the boundary newline (the separator between the last
 *    shown line and the first hidden line) and the trailing `+1` then double-
 *    counts — reporting one MORE hidden line than exist. Scan from kept.length+1
 *    (strictly past the boundary newline) so only the hidden lines' own newlines
 *    are counted, then +1 for the first hidden line (which has no preceding
 *    newline in that range). E.g. for "A\nB\nC\nD" cut after "B": hidden = C,D = 2,
 *    not 3.
 *
 *  - Mid-line (no newline within the cap — a single line longer than the cap):
 *    the cut splits a line, so `kept` shows the first part of a line whose
 *    remainder is hidden. Counting newlines from the cap and adding 1 correctly
 *    counts that partially-shown line plus the fully hidden lines after it.
 *
 * @param {string} full   the full snippet text
 * @param {number} cap    the character cap to truncate at
 * @param {(s: string, ch: string, start: number) => number} countOccurrences
 *        counts occurrences of `ch` in `s` from index `start` (countCharInString)
 * @returns {string}
 */
export function truncateSnippet(full, cap, countOccurrences) {
  if (full.length <= cap) {
    return full
  }

  // Truncate at the last line boundary that fits within the cap.
  const cutoff = full.lastIndexOf('\n', cap)
  if (cutoff > 0) {
    const kept = full.slice(0, cutoff)
    const remaining = countOccurrences(full, '\n', kept.length + 1) + 1
    return `${kept}\n\n... [${remaining} lines truncated] ...`
  }

  // No newline within the cap: a mid-line cut. The +1 accounts for the
  // partially-shown line whose remainder is hidden.
  const kept = full.slice(0, cap)
  const remaining = countOccurrences(full, '\n', cap) + 1
  return `${kept}\n\n... [${remaining} lines truncated] ...`
}
