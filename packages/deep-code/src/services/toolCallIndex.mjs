// Resolve the accumulator slot for a streaming tool-call delta.
//
// OpenAI-compatible streams emit tool calls as deltas, each (conformant) delta
// carrying a per-call `index` (0, 1, 2, …) that groups a call's chunks. The
// assemblers key their accumulator Map on that index. But a non-conformant
// gateway (some LiteLLM / llama.cpp-server configurations) can OMIT `index`
// entirely while still issuing two PARALLEL tool calls with distinct ids. The
// old `event.index ?? 0` then mapped BOTH calls onto slot 0: the second call's
// id/name overwrote the first's and their argument fragments concatenated into
// one corrupt, unparseable tool_use block — the first call lost.
//
// Fix: when the wire `index` is absent, disambiguate by the call's stable `id`.
// Reuse the slot already assigned to that id; otherwise take the smallest free
// slot. A conformant stream (every delta has a valid integer index) never
// reaches the id path, so its slot assignment is byte-identical to before. A
// single call with no index but an id still lands on slot 0 (the empty map's
// smallest free slot), also byte-identical; only a SECOND distinct id now gets
// its own slot instead of colliding.
//
// The accumulator entries already store `.id` (every assembler's tool-call
// shape has it), so the mapping needs no extra persistent state — it reads the
// live Map the caller is building.
//
/**
 * @param {Map<number, { id?: string } & Record<string, unknown>>} toolCalls
 *   the accumulator being built, keyed by resolved slot.
 * @param {{ index?: unknown, id?: unknown }} event a tool_call_delta event.
 * @returns {number} the slot this delta belongs to.
 */
export function resolveToolCallIndex(toolCalls, event) {
  // Conformant streams carry a valid per-call index — use it verbatim.
  if (
    typeof event.index === 'number' &&
    Number.isInteger(event.index) &&
    event.index >= 0
  ) {
    return event.index
  }
  // No wire index: group this delta with earlier deltas of the same call by id,
  // so two concurrent calls don't collapse onto one slot.
  if (typeof event.id === 'string' && event.id) {
    for (const [slot, entry] of toolCalls) {
      if (entry && entry.id === event.id) {
        return slot
      }
    }
    return smallestFreeSlot(toolCalls)
  }
  // Neither index nor id: legacy single-slot fallback (matches `index ?? 0`).
  return 0
}

/**
 * The smallest non-negative integer not already a key in the map. For the
 * contiguous slots the id path allocates (0, 1, 2, …) this is just the next
 * one; it also fills any gap left by a mixed/sparse stream, so it never
 * collides with an existing slot.
 * @param {Map<number, unknown>} toolCalls
 * @returns {number}
 */
function smallestFreeSlot(toolCalls) {
  let slot = 0
  while (toolCalls.has(slot)) {
    slot += 1
  }
  return slot
}
