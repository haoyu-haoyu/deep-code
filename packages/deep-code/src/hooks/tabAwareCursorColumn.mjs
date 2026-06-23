/**
 * Tab-aware display column for the NATIVE declared cursor (the physical terminal
 * cursor the IME preedit, screen readers, and magnifiers track).
 *
 * stringWidth counts a TAB (U+0009) as 0 cells, so the stringWidth-space column
 * (cursorPos.column, used for navigation) places the declared cursor LEFT of the
 * glyph that actually follows a pasted literal tab — the terminal advances a tab
 * to the next 8-column stop. (The VISIBLE inverted caret is already correct: the
 * output layer expands tabs at write time. Only this declared-cursor column needs
 * the adjustment, and only it consumes this value.)
 *
 * The adjustment is applied ONLY on a logical-line-start row (isPrecededByNewline)
 * that actually contains a tab — there the row text maps directly to the column
 * with no wrapped-continuation leading-whitespace trimming, so the tab-expanded
 * prefix width is exact. On any other row (or a tab-free prefix) the unmodified
 * fallbackColumn is returned, so the common case is byte-identical.
 *
 * expandTabs and measureWidth are injected (the real ones are ink/tabstops
 * expandTabs and ink/stringWidth) so this stays a node-testable leaf.
 *
 * @param {object} args
 * @param {string} args.lineText            full text of the cursor's wrapped row
 * @param {number} args.prefixEnd           code-unit index of the cursor within lineText
 * @param {boolean} args.isPrecededByNewline whether the row starts a logical line
 * @param {number} args.fallbackColumn      the stringWidth-space column (cursorPos.column)
 * @param {(text: string) => string} args.expandTabs
 * @param {(text: string) => number} args.measureWidth
 * @returns {number}
 */
export function tabAwareCursorColumn({
  lineText,
  prefixEnd,
  isPrecededByNewline,
  fallbackColumn,
  expandTabs,
  measureWidth,
}) {
  if (!isPrecededByNewline) return fallbackColumn
  if (typeof lineText !== 'string' || !lineText.includes('\t')) return fallbackColumn
  const prefix = lineText.slice(0, Math.max(0, prefixEnd))
  if (!prefix.includes('\t')) return fallbackColumn
  return measureWidth(expandTabs(prefix))
}
