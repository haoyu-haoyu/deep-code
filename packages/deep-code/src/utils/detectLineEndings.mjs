/**
 * Detect a string's dominant line-ending style by a majority vote over its
 * actual newlines: a '\n' preceded by '\r' counts toward CRLF, a lone '\n'
 * toward LF; a lone '\r' is ignored. CRLF wins only on a strict majority — a tie
 * (including a file with no newlines) resolves to LF.
 *
 * IMPORTANT: this must be given the WHOLE file content. A caller that passed
 * only the first 4096 characters mis-detected a CRLF file whose first line
 * exceeds 4096 chars (a wide CSV/TSV header, a single-line JSON/SQL preface, a
 * long banner) — the prefix held no '\n' at all, so the vote was 0/0 → 'LF', and
 * the subsequent write flipped every CRLF in the file to LF (silent whole-file
 * corruption). The per-character scan is O(n) time and O(1) memory, so scanning
 * the full content (already read into memory) is cheap.
 *
 * @param {string} content
 * @returns {'CRLF' | 'LF'}
 */
export function detectLineEndingsForString(content) {
  let crlfCount = 0
  let lfCount = 0

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      if (i > 0 && content[i - 1] === '\r') {
        crlfCount++
      } else {
        lfCount++
      }
    }
  }

  return crlfCount > lfCount ? 'CRLF' : 'LF'
}
