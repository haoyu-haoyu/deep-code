// FileEdit normalizes the model's straight quotes to match a file region that
// uses curly quotes: findActualString picks ONE concrete quote variant
// (actualOldString), and the replace then operates on only that variant
// (applyEditToFile → replaceAll(actualOldString)). When the SAME token appears
// in the file under DIFFERENT quote styles — e.g. a curly “foo” and a straight
// "foo" — a replace_all touches only the matched variant and silently leaves the
// siblings behind, while the tool still reports "All occurrences were
// successfully replaced".
//
// This leaf counts how many quote-insensitive occurrences a literal
// replaceAll(actualOldString) would MISS. The caller injects `normalize`
// (utils.ts owns normalizeQuotes) so the leaf stays dependency-free and
// node-testable.
//
// Correctness relies on normalizeQuotes being length-preserving — each curly
// quote is a single code unit mapped to one straight ASCII char — so split-based
// counts over the original and the normalized string are directly comparable,
// and the match POSITIONS line up. Normalization can only MERGE distinct quote
// variants into one form, never split them, so the normalized count is always
// >= the literal count; the difference is exactly the siblings a literal
// replaceAll would skip.
export function countMissedQuoteVariants(file, actualOldString, normalize) {
  if (!actualOldString) {
    return 0
  }
  const literal = file.split(actualOldString).length - 1
  const normalized =
    normalize(file).split(normalize(actualOldString)).length - 1
  return Math.max(0, normalized - literal)
}
