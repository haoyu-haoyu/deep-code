// preserveQuoteStyle previously restored a file's curly-quote typography onto an
// edit's new_string: when old_string matched a file region that uses curly
// quotes (the model can only emit straight ASCII quotes — see normalizeQuotes),
// it rewrote new_string's straight quotes to the file's curly glyphs.
//
// That is not safely possible. The model writes ALL quotes straight, and there
// is no reliable way to tell a quote it is PRESERVING (the file's curly
// typography it should restore) from a quote it NEWLY wrote in code (which must
// stay straight, or syntax breaks). Every selective heuristic was shown by
// adversarial review to curl a model-written quote and silently corrupt
// code/JSON/shell on disk:
//   - "curl every straight quote in new_string"  →  `--env="prod"` became
//     `--env=”prod”` (a broken shell flag) whenever the edited region had a
//     curly quote;
//   - "transplant onto the unchanged common prefix/suffix"  →  a model-new
//     closing quote that lands in the shared tail (`run "x" now` edited to
//     `run --env="prod" now`) is curled;
//   - even gating on "the changed middle has no quote AND the per-type quote
//     count is unchanged" leaves a hole: the greedy common-suffix scan absorbs a
//     model-new quote at the inserted-span boundary (`x' '` → `abc' '` yields
//     `abc’ ’`), which the changed-middle check never inspects.
//
// Because whether a model-written quote is preserved-prose or new-code is
// fundamentally ambiguous, and corrupting source code far outweighs the cosmetic
// benefit (curly typography in edited prose — which the model cannot type
// anyway), do NOT alter the model's quotes. Return new_string verbatim. The
// surrounding file keeps its own curly quotes; only the edited span uses the
// model's straight quotes (a harmless typography mix, never a syntax error).
//
// (If a provably corruption-free restoration is ever found, reimplement here —
// this is the single seam all three call sites route through.)
export function preserveQuoteStyle(_oldString, _actualOldString, newString) {
  return newString
}
