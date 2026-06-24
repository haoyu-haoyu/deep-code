/**
 * A tiny last-N cache for a value derived PURELY from (text, columns).
 *
 * The prompt editor rebuilds a MeasuredText (wrapAnsi + Intl grapheme/word
 * segmentation over the whole buffer) on EVERY render via Cursor.fromText. But it
 * re-renders on every cursor-only move (arrows, Home/End, word jumps — text
 * unchanged), on terminal focus blink, on notifications, and on the voice-mode
 * 50ms animation frame. On each of those the wrap/segmentation result is
 * byte-identical (it depends only on text + columns) yet fully recomputed — a few
 * hundred microseconds for a typical prompt, ~11ms for a 3000-char paste, ~135ms
 * for a 50KB paste (a visibly frozen frame). Returning the SAME instance for an
 * unchanged (text, columns) eliminates that redundant work; a hit is a handful of
 * nanoseconds.
 *
 * Correctness: MeasuredText is immutable after construction (its lazy caches are
 * pure functions of text+columns and are never mutated externally), so sharing
 * one instance across renders is behavior-identical for every output. The cursor
 * OFFSET lives on Cursor, not MeasuredText, so a fresh Cursor still wraps the
 * shared MeasuredText each render. A column change (terminal resize) is part of
 * the key, so a stale wrap is never served.
 *
 * Kept to a small N (default 2: one "current" buffer plus a second slot for the
 * vim/search input that measures a second buffer in the same render) so a long
 * session — or a cleared 50KB paste — never retains more than N buffers.
 *
 * Correctness does NOT depend on N: a smaller cache only lowers the hit rate, it
 * never returns a wrong instance (the key is the full (text, columns)).
 *
 * @template V
 * @param {(text: string, columns: number) => V} build  constructs the value on a miss
 * @param {number} [maxSize]  max distinct (text, columns) entries retained
 * @returns {(text: string, columns: number) => V}
 */
export function createKeyedCache(build, maxSize = 2) {
  // Most-recently-used last. Small N → linear scan is cheaper than a Map+key.
  const entries = []

  return function get(text, columns) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.text === text && e.columns === columns) {
        // Promote to most-recently-used.
        if (i !== entries.length - 1) {
          entries.splice(i, 1)
          entries.push(e)
        }
        return e.value
      }
    }
    const value = build(text, columns)
    entries.push({ text, columns, value })
    if (entries.length > maxSize) {
      entries.shift() // evict least-recently-used
    }
    return value
  }
}
