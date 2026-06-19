// Whole-line grapheme clustering for styled terminal output.
//
// The input is a tokenized StyledChar[] — ONE entry per CODE POINT, each tagged
// with the ANSI styles active at that point (the output of ansi-tokenize's
// tokenize() + styledCharsFromTokens). The old code re-clustered graphemes PER
// STYLE RUN: it flushed a buffer whenever the style changed and only then segmented
// that run into graphemes. So a grapheme cluster straddling a style boundary (an
// ANSI code emitted in the MIDDLE of a cluster — e.g. a base char and its combining
// mark / ZWJ / VS16 living in adjacent styled <Text> children) was split across two
// buffers and segmented independently, making Σ(per-run grapheme widths) drift from
// stringWidth(whole line) that layout/clip reserved — overflowing or blanking a cell.
//
// This clusters the WHOLE logical line into graphemes ONCE, then assigns each
// grapheme the style of its FIRST code point, so a cluster crossing a style boundary
// stays one cell-unit with one width. Σ(grapheme width) ≡ stringWidth(line) by
// construction (the graphemes are exactly the units stringWidth sums). Consecutive
// graphemes with equal styles are coalesced into runs so the caller interns each
// distinct style run exactly once (preserving the per-run intern optimization).
//
// Pure: imports nothing (NOT the vendored @alcalzone/ansi-tokenize shim, which is
// not a declared dependency). The grapheme segmenter, width fn and styles-equality
// predicate are injected so this stays node-testable without a TUI/vendored harness.

/**
 * @template S
 * @param {ReadonlyArray<{ value: string, styles: S }>} chars  one entry per code point
 * @param {{
 *   segment: (s: string) => Iterable<{ segment: string }>,
 *   width: (g: string) => number,
 *   stylesEqual: (a: S, b: S) => boolean,
 * }} deps
 * @returns {{ graphemes: Array<{ value: string, width: number, runIndex: number }>, runStyles: S[] }}
 */
export default function clusterStyledChars(chars, { segment, width, stylesEqual }) {
  const graphemes = []
  const runStyles = []
  if (chars.length === 0) return { graphemes, runStyles }

  // Reassemble the plain line and remember the UTF-16 start offset of each code
  // point so a grapheme can be mapped back to its first code point's styles.
  let plain = ''
  const offsets = new Array(chars.length)
  for (let i = 0; i < chars.length; i++) {
    offsets[i] = plain.length
    plain += chars[i].value
  }

  let charPtr = 0
  let segOffset = 0
  let curRunStyles
  let curRunIndex = -1
  let haveRun = false

  for (const { segment: grapheme } of segment(plain)) {
    // Advance to the code point that STARTS this grapheme (grapheme boundaries are
    // always code-point boundaries, so offsets[charPtr] lands exactly on segOffset).
    while (charPtr < offsets.length && offsets[charPtr] < segOffset) charPtr += 1
    const styles =
      charPtr < chars.length
        ? chars[charPtr].styles
        : chars[chars.length - 1].styles

    if (!haveRun || !stylesEqual(styles, curRunStyles)) {
      curRunStyles = styles
      runStyles.push(styles)
      curRunIndex = runStyles.length - 1
      haveRun = true
    }

    graphemes.push({ value: grapheme, width: width(grapheme), runIndex: curRunIndex })
    segOffset += grapheme.length
  }

  return { graphemes, runStyles }
}
