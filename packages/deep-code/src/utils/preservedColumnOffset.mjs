/**
 * Offset on a target logical line that preserves the cursor's DISPLAY column
 * from the current logical line — the vim j/k "curswant" semantics (j/k keep the
 * cursor under the same screen column).
 *
 * The previous logical-line up/down used a CODE-UNIT column (offset - lineStart)
 * directly as an offset on the target line. That drifts off the intended screen
 * column whenever the two lines differ in display width per code unit (a CJK or
 * emoji wide char, or a tab), because one code unit is not one screen cell. The
 * wrapped-line up()/down() already convert through display columns; the logical
 * variants bypassed that machinery. This restores the symmetry: measure the
 * display column on the current line, then find the code-unit index at that same
 * display column on the target line (which also clamps to the target line's end).
 *
 * The two conversions are injected so the leaf is pure and node-testable; the
 * caller passes MeasuredText.stringIndexToDisplayWidth / displayWidthToStringIndex.
 *
 * @param {string} currentLineText            text of the cursor's current logical line
 * @param {number} codeUnitColInCurrentLine   cursor offset within the current line (code units)
 * @param {string} targetLineText             text of the destination logical line
 * @param {number} targetLineStart            absolute offset where the target line starts
 * @param {(text: string, index: number) => number} stringIndexToDisplayWidth
 * @param {(text: string, width: number) => number} displayWidthToStringIndex
 * @returns {number} the absolute offset on the target line at the preserved column
 */
export function preservedColumnOffset(
  currentLineText,
  codeUnitColInCurrentLine,
  targetLineText,
  targetLineStart,
  stringIndexToDisplayWidth,
  displayWidthToStringIndex,
) {
  const displayColumn = stringIndexToDisplayWidth(
    currentLineText,
    codeUnitColInCurrentLine,
  )
  const codeUnitIndex = displayWidthToStringIndex(targetLineText, displayColumn)
  return targetLineStart + codeUnitIndex
}
