// IDE text-selection ranges are stored 0-BASED (the LSP Position convention):
// useIdeSelection stores `lineStart: start.line` raw, and the attachment derives
// `lineEnd = lineStart + lineCount - 1` — both 0-based. The model and the editor use
// 1-BASED line numbers, and the sibling diagnostics path already converts at render
// (diagnosticTracking.ts renders `[Line ${range.start.line + 1}:...]`). The IDE
// selection render omitted the +1, so the model was told a selection one line too low
// on BOTH ends and would act on the line above the user's true selection. Convert the
// stored 0-based range to the 1-based "<start> to <end>" the model sees, here, so it
// matches the editor and the diagnostics convention.
//
// @param {number} lineStart  0-based first selected line
// @param {number} lineEnd    0-based last selected line
// @returns {string}  "<start> to <end>" in 1-based line numbers
export function formatSelectedLineRange(lineStart, lineEnd) {
  return `${lineStart + 1} to ${lineEnd + 1}`
}
