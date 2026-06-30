// Join per-file diagnostic blocks into the model-facing summary within a character
// budget WITHOUT silently dropping a higher-severity block before a lower-severity one.
//
// The previous renderer concatenated files in arrival order and, on overflow, did a
// flat `result.slice(0, MAX)` — so a trailing file's ERRORS were cut mid-string when
// earlier (Warning-only) files filled the budget, and the model was given no count of
// what was dropped. Here the error-bearing files are rendered FIRST and whole trailing
// (lowest-severity) blocks are dropped at block boundaries, with a count of the omitted
// diagnostics appended, so the model always sees the errors and knows more exist.
//
// blocks: [{ text: string, severityRank: number, count: number }]
//   text         = the file's fully-rendered block (header + its diagnostic lines,
//                  already severity-sorted within the file so errors render first)
//   severityRank = the block's highest-severity rank (lower = more severe)
//   count        = number of diagnostics in the block
//
// @param {Array<{ text: string, severityRank: number, count: number }>} blocks
// @param {number} maxChars
// @returns {string}
export function joinDiagnosticBlocksWithinBudget(blocks, maxChars) {
  const SEP = '\n\n'
  // Error-bearing files first; stable tie-break on original order.
  const ordered = blocks
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) => a.severityRank - b.severityRank || a.i - b.i)

  const kept = []
  let used = 0
  let omittedDiagnostics = 0
  let omittedFiles = 0

  for (const block of ordered) {
    const sep = kept.length > 0 ? SEP.length : 0
    // Always include the first (most-severe) block even if it alone exceeds the
    // budget — the safety-net slice below trims its tail, keeping its leading
    // (error) lines. Later blocks are dropped whole once the budget is reached.
    if (kept.length === 0 || used + sep + block.text.length <= maxChars) {
      kept.push(block.text)
      used += sep + block.text.length
    } else {
      omittedDiagnostics += block.count
      omittedFiles += 1
    }
  }

  let result = kept.join(SEP)

  // Safety net for a single first block larger than the whole budget: trim the KEPT
  // content at a line boundary (before any omitted marker) so a diagnostic is never
  // cut mid-line and its leading (error) lines survive.
  if (result.length > maxChars) {
    const marker = '…[truncated]'
    const room = Math.max(0, maxChars - marker.length)
    const sliced = result.slice(0, room)
    const lastNewline = sliced.lastIndexOf('\n')
    const body = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced
    result = body + (body.endsWith('\n') ? '' : '\n') + marker
  }

  // Append the omitted-count marker LAST. It is a short, soft overflow of the budget
  // (the budget is a guideline, not a hard wire limit) and must not itself be trimmed
  // away — the model needs to know diagnostics were dropped.
  if (omittedFiles > 0) {
    result += `${SEP}…[${omittedDiagnostics} more diagnostic${
      omittedDiagnostics === 1 ? '' : 's'
    } in ${omittedFiles} more file${omittedFiles === 1 ? '' : 's'} omitted]`
  }

  return result
}
