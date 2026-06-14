// FileEdit normalizes the model's straight quotes to match a file region that
// uses curly quotes: findActualString picks ONE concrete quote variant
// (actualOldString), and the replace then operates on only that variant
// (applyEditToFile → replaceAll(actualOldString)). When the SAME token appears
// in the file under DIFFERENT quote styles — e.g. a curly “foo” and a straight
// "foo" — a replace_all touches only the matched variant and silently leaves the
// siblings behind, while the tool still reports "All occurrences were
// successfully replaced".
//
// This leaf estimates how many quote-insensitive occurrences a literal
// replaceAll(actualOldString) would MISS, by comparing non-overlapping
// occurrence counts in the original vs the quote-normalized string. The caller
// injects `normalize` (utils.ts owns normalizeQuotes) so the leaf stays
// dependency-free and node-testable. normalizeQuotes is length-preserving (each
// curly quote is one code unit mapped to one straight ASCII char), so the two
// strings align position-for-position.
//
// The count is exact for a token that carries non-quote content: every extra
// occurrence in the normalized string corresponds to a genuine different-style
// sibling that the literal replaceAll skips. It is NOT reliable when the needle
// is composed ENTIRELY of quote characters: `String.split` counts non-overlapping
// pairs, and merging an adjacent run of differently-styled quotes under
// normalization can manufacture phantom cross-boundary pairs (e.g. needle `""`
// against a file region `“"""` over-counts, even though a real replaceAll leaves
// nothing behind). A bare-quote-run is not a meaningful token to track across
// quote styles anyway, and a realistic string-literal edit always carries
// non-quote content — so skip such needles entirely (they fall back to the prior
// behavior, never a spurious "under-replace" rejection).
export function countMissedQuoteVariants(file, actualOldString, normalize) {
  if (!actualOldString) {
    return 0
  }
  const normalizedNeedle = normalize(actualOldString)
  // All-quote-character needle → unreliable split-delta (see header). Skip.
  if (normalizedNeedle.replace(/["']/g, '') === '') {
    return 0
  }
  const literal = file.split(actualOldString).length - 1
  const normalized = normalize(file).split(normalizedNeedle).length - 1
  return Math.max(0, normalized - literal)
}
