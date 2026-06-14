// Split `text` into ordered runs, marking each run that matches `query`
// (case-insensitive) as highlighted. This is the pure match-offset arithmetic behind
// highlightMatch's inverse-highlight rendering (search dialogs) — extracted so it can be
// unit-tested without React. Matches are non-overlapping, left-to-right (indexOf scan from
// the end of the previous match). An empty query or no match returns a single
// unhighlighted run holding the whole text, which the renderer short-circuits to the raw
// string (matching the old `return text`).
//
// toLowerCase() is NOT length-preserving — some code points fold to more (or fewer) code
// units than they occupy in the original (e.g. 'İ' U+0130 → 'i̇' = U+0069 U+0307). So an
// index found in `text.toLowerCase()` does not address `text`, and the match length differs
// from the original substring length. Searching the folded haystack but slicing the ORIGINAL
// text by a parallel source-index map keeps the highlighted run aligned to what the user
// actually sees ('İstanbul' + query 'bul' highlights 'bul', not 'ul').
export function computeHighlightSpans(text, query) {
  if (!query) return [{ text, highlighted: false }]
  const queryLower = query.toLowerCase()

  // Build the case-folded haystack alongside, for each folded code unit, the
  // [start, end) span of the ORIGINAL source code point it came from. Multiple
  // folded units from one source code point all map to that code point's span,
  // so a match covering any of them highlights the whole source code point.
  let lowered = ''
  const srcStart = []
  const srcEnd = []
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i)
    const srcLen = cp > 0xffff ? 2 : 1
    const folded = text.slice(i, i + srcLen).toLowerCase()
    for (let k = 0; k < folded.length; k++) {
      srcStart.push(i)
      srcEnd.push(i + srcLen)
    }
    lowered += folded
    i += srcLen
  }

  let loweredIdx = lowered.indexOf(queryLower, 0)
  if (loweredIdx === -1) return [{ text, highlighted: false }]

  const spans = []
  let offset = 0 // cursor in the ORIGINAL text
  while (loweredIdx !== -1) {
    const loweredEnd = loweredIdx + queryLower.length
    // Map the folded match span back to the original code points it overlaps:
    // the start of the first source code point through the end of the last.
    const start = srcStart[loweredIdx]
    const end = srcEnd[loweredEnd - 1]
    // Keep runs ordered and non-overlapping. A normal match advances past
    // `offset`; the clamp only guards the degenerate case where a later folded
    // match maps back into a source code point already emitted (so `end` could
    // be <= offset, or `start` < offset), which the renderer must never see.
    if (end > offset) {
      const runStart = start > offset ? start : offset
      if (runStart > offset) spans.push({ text: text.slice(offset, runStart), highlighted: false })
      spans.push({ text: text.slice(runStart, end), highlighted: true })
      offset = end
    }
    loweredIdx = lowered.indexOf(queryLower, loweredEnd)
  }
  if (offset < text.length) spans.push({ text: text.slice(offset), highlighted: false })
  return spans
}
