// Word-level diffing uses the `diff` package's diffArrays — a Myers diff that is
// worst-case O(N·D) in BOTH time and memory. For a very long changed line (a
// minified JS/CSS bundle line, a lockfile line, a long base64/JSON blob) that runs
// for seconds to minutes — and because the diff display renders synchronously inside
// the Ink/React render path, it freezes the whole TUI (or OOMs).
//
// The sibling structuredPatch() calls in utils/diff.ts bound the same algorithm with
// `timeout: DIFF_TIMEOUT_MS`; this word-diff path never got a bound (a porting
// regression from the Rust `similar` crate's internal deadline). Skip word-diffing
// above a combined input size and fall back to whole-line add/remove highlighting —
// the SAME [[], []] result wordDiffStrings already returns for substantially-different
// lines (the change-ratio early-out), so the rendered output is unchanged. A line this
// long already wraps to many terminal rows, so per-word highlighting adds no value.
//
// ~5000 combined chars bounds diffArrays to well under 100ms worst-case.
export const WORD_DIFF_MAX_TOTAL_CHARS = 5000

export function wordDiffTooLarge(oldStr, newStr) {
  return oldStr.length + newStr.length > WORD_DIFF_MAX_TOTAL_CHARS
}
