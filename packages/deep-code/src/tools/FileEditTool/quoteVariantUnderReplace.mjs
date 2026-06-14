// FileEdit normalizes the model's straight quotes to match a file region that
// uses curly quotes: findActualString picks ONE concrete quote variant
// (actualOldString), and the replace then operates on only that variant
// (applyEditToFile → replaceAll(actualOldString)). When the SAME token appears
// in the file under DIFFERENT quote styles — e.g. a curly “foo” and a straight
// "foo" — a replace_all touches only the matched variant and silently leaves the
// siblings behind, while the tool still reports "All occurrences were
// successfully replaced".
//
// This leaf returns how many quote-insensitive occurrences of the needle a
// literal replaceAll(actualOldString) would leave behind — the genuine
// different-style siblings. The caller injects `normalize` (utils.ts owns
// normalizeQuotes).
//
// It is computed by SIMULATING the real replace and recounting, NOT by a
// split-count delta. A naive `normalizedCount - literalCount` over-counts
// whenever normalized occurrences OVERLAP on a shared character: normalizing the
// file can manufacture extra (overlapping) matches that a real, non-overlapping
// replaceAll never leaves behind (e.g. needle `b"b` against `b“b"b“b’`, or any
// all-quote needle like `""` against `“"""`). So instead: replace every literal
// occurrence of actualOldString with a sentinel char that the normalized needle
// cannot contain (so no remaining match can span a replaced region — exactly the
// non-overlapping semantics of String.replaceAll), then count how many
// normalized-needle occurrences survive. Those are real siblings the literal
// replace skips.
export function countMissedQuoteVariants(file, actualOldString, normalize) {
  if (!actualOldString) {
    return 0
  }
  const normalizedNeedle = normalize(actualOldString)
  const sentinel = pickAbsentChar(normalizedNeedle)
  // split/join replaces the literal matches exactly as replaceAll would (greedy,
  // left-to-right, non-overlapping). The sentinel breaks any cross-boundary span.
  const afterLiteralReplace = file.split(actualOldString).join(sentinel)
  return countNonOverlapping(normalize(afterLiteralReplace), normalizedNeedle)
}

// Count non-overlapping occurrences of `needle` in `haystack`, mirroring how
// String.prototype.replaceAll consumes matches (advance past each match).
function countNonOverlapping(haystack, needle) {
  if (!needle) {
    return 0
  }
  let count = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    count++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return count
}

// A single character guaranteed absent from `needle`, so a `needle` match can
// never overlap it. `needle` is finite, so one of a few fixed low/PUA code
// points (none of which are curly quotes, so `normalize` leaves them intact) is
// absent; fall back to a scan in the pathological case. Built from char codes so
// no literal control bytes appear in source.
function pickAbsentChar(needle) {
  const candidates = [0x0, 0x1, 0x2, 0xe000, 0xffff]
  for (const code of candidates) {
    const c = String.fromCharCode(code)
    if (!needle.includes(c)) {
      return c
    }
  }
  let code = 0x3
  while (needle.includes(String.fromCharCode(code))) {
    code++
  }
  return String.fromCharCode(code)
}
