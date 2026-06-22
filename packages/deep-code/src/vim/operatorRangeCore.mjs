/**
 * Decide whether an inclusive vim motion's operator range end should be bumped
 * forward by one grapheme (to make the motion's last character inclusive).
 *
 * The inclusive motions are e / E / $ (isInclusiveMotion = 'eE$'). e and E land
 * ON the last visible character of a word, so the half-open operator range
 * [from, end) must extend one past that character to actually
 * delete/yank/change it — hence the +1 bump.
 *
 * '$' is different: endOfLogicalLine() returns the offset OF the line's '\n'
 * (`findLogicalLineEnd` = indexOf('\n')), which is already ONE PAST the last
 * visible character — the exclusive end of the line's content. Bumping it pushes
 * the range past the newline, so D / C / d$ / c$ delete the line break and join
 * the next line (data loss). Suppress the bump exactly when the prospective end
 * sits ON a newline: among the inclusive motions only '$' can land there (e/E
 * land on a visible word char), and at end-of-file `charAtEnd` is undefined so
 * single-line D / C still bump (a no-op, since the end is already text.length).
 *
 * @param {object} params
 * @param {boolean} params.isInclusive  isInclusiveMotion(motion)
 * @param {number} params.cursorOffset  the cursor offset before the motion
 * @param {number} params.targetOffset  the motion target offset
 * @param {string | undefined} params.charAtEnd  the character at the prospective range end (cursor.text[to])
 * @returns {boolean} true iff the inclusive +1 bump should be applied
 */
export function shouldApplyInclusiveBump({
  isInclusive,
  cursorOffset,
  targetOffset,
  charAtEnd,
}) {
  return isInclusive && cursorOffset <= targetOffset && charAtEnd !== '\n'
}
