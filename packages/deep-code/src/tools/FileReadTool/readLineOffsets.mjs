// Single source of truth for the two line indices the Read tool derives from
// the 1-based `offset` input:
//   - lineOffset: the 0-based index handed to readFileInRange
//   - startLine:  the 1-based label used to number the returned lines (and
//                 echoed in the "shorter than the provided offset" warning)
//
// These were computed independently — `lineOffset = offset === 0 ? 0 : offset-1`
// but `startLine = offset` — so they only agreed for offset >= 1. When the model
// passes the schema-allowed `offset: 0`, lineOffset was 0 (reads from the first
// line, correct) while startLine was 0, mislabelling the first line as line 0
// and every subsequent line off-by-one. Deriving startLine from lineOffset makes
// the two indices consistent by construction:
//   offset 0 -> { lineOffset: 0, startLine: 1 }   (was startLine 0)
//   offset 1 -> { lineOffset: 0, startLine: 1 }   (unchanged)
//   offset N -> { lineOffset: N-1, startLine: N } (unchanged for N >= 1)
// so the only behavioural change is the offset === 0 display, and startLine is
// byte-identical for every offset >= 1.
export function resolveReadLineOffsets(offset) {
  const lineOffset = offset === 0 ? 0 : offset - 1
  return { lineOffset, startLine: lineOffset + 1 }
}
