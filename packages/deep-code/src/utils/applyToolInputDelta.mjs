/**
 * Accumulate a streaming tool-call argument delta into the matching
 * StreamingToolUse entry, PRESERVING array order and every element's identity.
 *
 * The previous reducer matched the entry by content-block index, removed it via
 * `filter(_ => _ !== element)`, and re-appended an updated copy at the array
 * TAIL — reordering the list on every `input_json_delta`. With two or more
 * parallel streaming tool_use blocks and interleaved argument deltas that has
 * two costs:
 *   1. the streaming tool-use previews jump around (rendered in array order,
 *      which became "most-recently-delta'd last" instead of content-block order);
 *   2. it defeats the Messages memo comparator, which compares
 *      `prev[i].contentBlock === next[i].contentBlock` POSITIONALLY — a reorder
 *      makes index 0 differ, so the comparator returns false and the entire
 *      Messages subtree re-renders on EVERY delta (the "full re-render per
 *      token" anti-pattern).
 *
 * An in-place map keeps the order stable and preserves each element's
 * `contentBlock` reference (the spread copies it), so the comparator skips the
 * re-render again and the previews render in content-block order. The
 * `unparsedToolInput` accumulation is byte-identical to the old reducer.
 *
 * Returns a NEW array when a matching entry is found (so the state update is
 * observed), or the SAME list reference when no entry matches the index
 * (mirroring the old `if (!element) return _`).
 *
 * @template {{ index: number, unparsedToolInput: string }} T
 * @param {T[]} list  the current StreamingToolUse array
 * @param {number} index  the content_block index the delta targets
 * @param {string} delta  the partial_json fragment to append
 * @returns {T[]}
 */
export function applyToolInputDelta(list, index, delta) {
  if (!Array.isArray(list)) return list
  let matched = false
  const next = list.map(el => {
    if (!matched && el && el.index === index) {
      matched = true
      return { ...el, unparsedToolInput: el.unparsedToolInput + delta }
    }
    return el
  })
  return matched ? next : list
}
