// Is a streamed tool_call id usable as-is? Only a NON-EMPTY string.
//
// A non-conformant OpenAI-compatible gateway (llama.cpp-server, or Go/Rust proxies
// that serialize an unset non-nullable string field as "") can send `id:""` — a
// present-but-EMPTY string. Both `??` (nullish, fires only on null/undefined) and
// `typeof id === 'string'` wrongly accept "", so the empty id survives assembly into
// the tool_use block. An empty tool_call id then WEDGES the multi-turn loop:
//   - the tool_result can't correlate back — dropOrphanToolMessages
//     (deepseek-normalizer.mjs) drops it because `entry.tool_call_id && …`
//     short-circuits on the falsy "";
//   - the now-unanswered tool_call is malformed/dangling and DeepSeek/OpenAI hard-400
//     the next /chat/completions request;
//   - because the assistant message persists in the append-only transcript, every
//     subsequent turn rebuilds the identical invalid request and re-400s — a permanent
//     session wedge (the exact class the `toolu_deepseek_*` id-fallback exists to
//     prevent, with the "" spelling left uncovered).
//
// Use this predicate at BOTH the initial id synthesis (usable ? event.id : fallback)
// AND the later-delta overwrite (only overwrite when usable — never DOWNGRADE an
// already-good id to "" when a trailing fragment carries an empty id). A conformant
// non-empty id is accepted verbatim, so the conformant path stays byte-identical.
//
// @param {unknown} id
// @returns {id is string} a type predicate so callers narrow a `string | undefined`
//   / `unknown` id to a usable non-empty `string` in the true branch (preserves the
//   narrowing the previous inline `typeof id === 'string'` gave).
/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isUsableToolCallId(id) {
  return typeof id === 'string' && id.length > 0
}
