/**
 * Compute the new stable-prefix boundary for StreamingMarkdown.
 *
 * StreamingMarkdown splits the streaming reply into a memoized stablePrefix
 * (never re-parsed/re-wrapped) and a small unstableSuffix (re-rendered per delta).
 * It lexes the text from the current boundary and treats every top-level block
 * EXCEPT the last as final, advancing the boundary past them.
 *
 * The marked dependency here is a DeepCode shim that only splits on HTML comments
 * and otherwise returns the WHOLE text as a single 'paragraph' token. So for an
 * ordinary reply the token loop finds exactly one content token, advance stays 0,
 * the boundary never moves, and the unstableSuffix === the entire growing reply —
 * which Ink then re-wraps in full on every frame: O(n^2) wrap work over a turn
 * (seconds of redundant CPU on a long reply, visible streaming jank).
 *
 * Fallback: when the lexer yields a single content block (advance stays 0), split
 * at the last CLEAN paragraph break instead. With the shim there is no inline or
 * block parsing — a paragraph renders as linkifyIssueReferences(text) (a
 * single-line repo#num replace that can never span a newline) — so completed
 * paragraphs are immutable.
 *
 * A "clean" break is EXACTLY two newlines bounded by non-whitespace on both sides
 * ("X\n\nY"). <Markdown> renders each sibling block as <Ansi>{content.trim()}</Ansi>
 * and the container joins them with gap={1} (exactly one blank row). A clean
 * "\n\n" in the whole also renders as exactly one blank row, so the split is
 * byte-identical. We must NOT split inside a 3+ newline run (>1 blank row, which
 * gap={1} cannot reproduce) or adjacent to spaces/indentation — the per-block
 * .trim() would eat that whitespace asymmetrically and drop a blank row or an
 * indented line during streaming. A lone "\n" boundary is likewise unsafe (it
 * would gain a spurious blank row).
 *
 * The boundary is monotonic (only advances), preserving the ref-mutation-safe
 * contract of the caller.
 *
 * @param {string} stripped      the full (XML-stripped) streaming text
 * @param {number} prevBoundary  the current stable-prefix length
 * @param {Array<{type: string, raw: string}>} tokens
 *        marked.lexer(stripped.substring(prevBoundary)) — injected so this is pure
 * @returns {number} the new boundary (>= prevBoundary)
 */
export function advanceStreamingBoundary(stripped, prevBoundary, tokens) {
  // Last non-space token is the growing block; everything before it is final.
  let lastContentIdx = tokens.length - 1
  while (lastContentIdx >= 0 && tokens[lastContentIdx].type === 'space') {
    lastContentIdx--
  }
  let advance = 0
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i].raw.length
  }

  if (advance === 0) {
    // Single content block (the shim's whole-text paragraph): fall back to the
    // last CLEAN paragraph break — exactly "\n\n" bounded by non-whitespace on
    // both sides — so the split renders byte-identically (see header).
    const unstable = stripped.substring(prevBoundary)
    const isContent = ch => ch !== undefined && !/\s/.test(ch)
    let i = unstable.lastIndexOf('\n\n')
    while (i > 0) {
      // i, i+1 are the two newlines. Require non-whitespace content IMMEDIATELY
      // before and after the pair. This makes it an isolated, exactly-two-newline
      // break (no 3+ newline run, whose >1 blank rows gap={1} can't reproduce; no
      // surrounding spaces/indentation the per-block .trim() would drop) AND
      // guarantees both the stable prefix and the suffix render non-empty, so the
      // gap={1} sits between two real blocks exactly like the "\n\n" in the whole.
      if (isContent(unstable[i - 1]) && isContent(unstable[i + 2])) {
        advance = i + 2 // include the "\n\n" in the stable prefix
        break
      }
      i = unstable.lastIndexOf('\n\n', i - 1)
    }
  }

  return advance > 0 ? prevBoundary + advance : prevBoundary
}
