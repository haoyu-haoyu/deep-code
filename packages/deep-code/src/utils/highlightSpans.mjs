// Split `text` into ordered runs, marking each run that matches `query`
// (case-insensitive) as highlighted. This is the pure match-offset arithmetic behind
// highlightMatch's inverse-highlight rendering (search dialogs) — extracted so it can be
// unit-tested without React. Matches are non-overlapping, left-to-right (indexOf scan from
// the end of the previous match). An empty query or no match returns a single
// unhighlighted run holding the whole text, which the renderer short-circuits to the raw
// string (matching the old `return text`).
export function computeHighlightSpans(text, query) {
  if (!query) return [{ text, highlighted: false }]
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  let idx = textLower.indexOf(queryLower, 0)
  if (idx === -1) return [{ text, highlighted: false }]

  const spans = []
  let offset = 0
  while (idx !== -1) {
    if (idx > offset) spans.push({ text: text.slice(offset, idx), highlighted: false })
    spans.push({ text: text.slice(idx, idx + query.length), highlighted: true })
    offset = idx + query.length
    idx = textLower.indexOf(queryLower, offset)
  }
  if (offset < text.length) spans.push({ text: text.slice(offset), highlighted: false })
  return spans
}
