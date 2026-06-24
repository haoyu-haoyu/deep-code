/**
 * A small content-keyed LRU that memoizes an EXPENSIVE pure computation and
 * returns a fresh COPY of the result on every call.
 *
 * <Ansi> parses its text into styled spans via the termio parser + Intl grapheme
 * segmentation (parseToSpans) — a pure function of the input string. React.memo +
 * the React-Compiler cache keep that off the per-keystroke path, but they do NOT
 * survive an unmount->remount: the virtual message list windows messages (off-
 * window items unmount) and ctrl+o unmounts/remounts the whole message tree. On
 * remount every visible <Ansi> re-segments byte-identical, immutable history text
 * from scratch (measured ~0.3-6ms per message; tens of ms for a screenful — a
 * dropped frame). Caching by content makes a remount an O(1) lookup.
 *
 * Why copy-on-return: the <Ansi> render mutates a span in place (sets
 * span.props.dim = true when dimColor) before passing it to StyledText. Returning
 * the cached array directly would let that mutation poison the cache (a later
 * non-dim render of the same content would see dim=true). Returning a fresh copy
 * each call keeps the cached canonical result pristine, so the result is byte-
 * identical to today's (callers always received a freshly-built, mutable array).
 * The copy is O(items) shallow allocation — far cheaper than the re-segmentation
 * it replaces.
 *
 * Bounded to maxSize entries (drop least-recently-used) so a long transcript does
 * not retain every message's spans. Correctness is independent of maxSize — a
 * smaller cache only lowers the hit rate, never returns a wrong result.
 *
 * @template T
 * @param {(input: string) => T[]} compute   the expensive pure parse
 * @param {(item: T) => T} copyItem          deep-enough copy of one result item
 * @param {number} [maxSize]
 * @returns {(input: string) => T[]}
 */
export function createSpanCache(compute, copyItem, maxSize = 200) {
  const entries = new Map() // input -> canonical (never-mutated) result array

  return function get(input) {
    let result = entries.get(input)
    if (result !== undefined) {
      // Promote to most-recently-used.
      entries.delete(input)
      entries.set(input, result)
    } else {
      result = compute(input)
      entries.set(input, result)
      if (entries.size > maxSize) {
        // Evict least-recently-used (Map preserves insertion order).
        entries.delete(entries.keys().next().value)
      }
    }
    // Fresh copy so the caller may mutate items without poisoning the cache.
    return result.map(copyItem)
  }
}
