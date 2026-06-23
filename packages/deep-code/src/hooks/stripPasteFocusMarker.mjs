/**
 * Remove a terminal focus-in / focus-out marker (ESC[I / ESC[O) that landed at
 * the very END of joined paste content.
 *
 * Such a marker can be appended to a paste when a focus event fires as the paste
 * completes. The previous strip removed only the bare bracket sequence ('[I' /
 * '[O') anchored at end-of-string, which was wrong in both directions:
 *
 *  - It ORPHANED the ESC: a real focus marker at the tail is ESC[I (with its
 *    ESC), so stripping just '[I' left a lone ESC byte that survived the
 *    downstream stripAnsi and ended up in the stored/submitted prompt.
 *  - It OVER-STRIPPED: any legitimately pasted text ending in the two literal
 *    characters '[I' or '[O' (e.g. 'value = arr[I') had them silently deleted.
 *
 * Anchoring the strip to the FULL marker (ESC included) removes a real focus
 * marker cleanly and never touches ESC-less user text. Mid-paste focus markers
 * (not at the tail) keep their ESC and are removed by the downstream stripAnsi.
 *
 * @param {string} joined  the joined paste chunks
 * @returns {string}
 */
export function stripTailFocusMarker(joined) {
  // eslint-disable-next-line no-control-regex
  return joined.replace(/\x1b\[[IO]$/, '')
}
