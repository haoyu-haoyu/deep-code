/**
 * Reconstruct, for each wrapped line produced by wrapAnsi(sourceText, columns,
 * {hard, trim:false}).split('\n'), the source-text offset it starts at — plus
 * whether it is preceded by / ends with a real source newline. MeasuredText uses
 * these offsets to map cursor offsets to wrapped (row, column) positions and back.
 *
 * The invariant every consumer relies on (getPositionFromOffset /
 * getOffsetFromPosition iterate lines with `offset >= startOffset && offset <
 * nextStartOffset`) is that startOffset is MONOTONIC NON-DECREASING and each
 * non-empty line is the verbatim slice sourceText.slice(startOffset,
 * startOffset+text.length).
 *
 * The previous reconstruction tracked blank lines and non-blank lines with two
 * SEPARATE cursors (a `lastNewLinePos` scanned via indexOf('\n') for blanks, a
 * `searchOffset` for non-blanks) and ASSUMED every blank wrapped line corresponds
 * to a real '\n' in the source. That holds for genuine empty source lines, but
 * wrapAnsi also emits a blank wrapped line when a SINGLE grapheme is wider than
 * the column width (e.g. a width-2 CJK/emoji char at an effective column width of
 * 1 wraps to ['', '一']). For that blank there is no source '\n', so the old code
 * stamped startOffset = sourceText.length (and, with a real newline elsewhere,
 * mis-bound to it) — producing a NON-MONOTONIC startOffset array. The cursor then
 * resolved to the wrong wrapped row (e.g. for '一\n二' at columns 1 the offset of
 * '二' mapped to the '一' row).
 *
 * Fix: a SINGLE forward cursor `pos` advanced for ALL lines. A blank line is a
 * genuine empty source line only when sourceText[pos] === '\n' (consume it);
 * otherwise it is a wrap-induced blank that consumes no source (startOffset stays
 * at the overflowing grapheme / end of text, pos does not advance). This yields a
 * monotonic non-decreasing startOffset array and is byte-identical to the old
 * records for every well-formed (no wrap-induced-blank) input.
 *
 * `\n` is the only line terminator recognized here, matching the old code: the
 * editor buffer is already CR-normalized upstream (paste via normalizePastedText,
 * keyboard via useTextInput), so sourceText never contains a lone `\r` / `\r\n`.
 *
 * @param {string[]} wrappedLines  wrapAnsi(...).split('\n')
 * @param {string} sourceText      the (NFC-normalized) text that was wrapped
 * @returns {Array<{text:string,startOffset:number,isPrecededByNewline:boolean,endsWithNewline:boolean}>}
 */
export function reconstructWrappedLineOffsets(wrappedLines, sourceText) {
  const records = []
  let pos = 0 // running index into sourceText

  for (let i = 0; i < wrappedLines.length; i++) {
    const text = wrappedLines[i]
    let startOffset
    let endsWithNewline

    if (text.length === 0) {
      startOffset = pos
      if (sourceText[pos] === '\n') {
        // A genuine empty source line: consume its newline.
        endsWithNewline = true
        pos += 1
      } else {
        // A wrap-induced blank (a grapheme wider than the column width, or a
        // trailing blank at end of text): consumes no source.
        endsWithNewline = false
      }
    } else {
      startOffset = sourceText.indexOf(text, pos)
      if (startOffset === -1) {
        throw new Error('Failed to find wrapped line in text')
      }
      pos = startOffset + text.length
      if (sourceText[pos] === '\n') {
        endsWithNewline = true
        pos += 1
      } else {
        endsWithNewline = false
      }
    }

    const isPrecededByNewline =
      i === 0 || (startOffset > 0 && sourceText[startOffset - 1] === '\n')

    records.push({ text, startOffset, isPrecededByNewline, endsWithNewline })
  }

  return records
}
