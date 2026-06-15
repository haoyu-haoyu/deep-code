// Rebuild FileEdit { old_string, new_string } pairs from a structuredPatch hunk
// list (one edit per hunk). Extracted to a node-testable leaf.
//
// A unified diff encodes "this line has no trailing newline" with a separate
// `\ No newline at end of file` marker placed immediately AFTER the -/+/context
// line it qualifies. The previous implementation routed lines only by ' '/'-'/'+'
// and join('\n')ed them, so it (a) silently dropped the marker and (b) carried NO
// trailing-newline information — a hunk whose ONLY change was adding or removing
// the file's final newline produced old_string === new_string (a no-op), and a
// content change that also toggled the final newline silently dropped the newline.
//
// Track the marker per side: a side's final newline is present UNLESS its last
// content line carried the marker. A context line (' ') belongs to both sides.
const NO_NEWLINE_MARKER = '\\ No newline at end of file'

export function getEditsForPatch(patch) {
  return patch.map(hunk => {
    const oldLines = []
    const newLines = []
    // Default: each side ends with a newline; the marker clears it for that side.
    let oldHasFinalNewline = true
    let newHasFinalNewline = true
    let prevSide = null // 'old' | 'new' | 'both'

    for (const line of hunk.lines) {
      if (line === NO_NEWLINE_MARKER) {
        // The marker qualifies the most recent content line.
        if (prevSide === 'old' || prevSide === 'both') oldHasFinalNewline = false
        if (prevSide === 'new' || prevSide === 'both') newHasFinalNewline = false
        continue
      }
      if (line.startsWith(' ')) {
        oldLines.push(line.slice(1))
        newLines.push(line.slice(1))
        oldHasFinalNewline = true
        newHasFinalNewline = true
        prevSide = 'both'
      } else if (line.startsWith('-')) {
        oldLines.push(line.slice(1))
        oldHasFinalNewline = true
        prevSide = 'old'
      } else if (line.startsWith('+')) {
        newLines.push(line.slice(1))
        newHasFinalNewline = true
        prevSide = 'new'
      }
    }

    let old_string = oldLines.join('\n')
    let new_string = newLines.join('\n')
    if (oldLines.length > 0 && oldHasFinalNewline) old_string += '\n'
    if (newLines.length > 0 && newHasFinalNewline) new_string += '\n'
    return { old_string, new_string, replace_all: false }
  })
}
