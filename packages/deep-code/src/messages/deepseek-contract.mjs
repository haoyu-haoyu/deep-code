// A first-principles, offline checker of the DeepSeek (and openai-compatible)
// /chat/completions *message contract* — the structural invariants whose
// violation makes the server hard-reject a request with HTTP 400. It is the
// oracle for the 400-immunity matrix (test/deepseek-400-immunity-matrix.test.mjs)
// and any future wedge fuzzer: feed it the OUTPUT of mapMessagesToDeepSeek and a
// `valid:true` verdict means the request will not 400 on a tool-pairing/shape
// fault.
//
// Deliberately INDEPENDENT of deepseek-normalizer.mjs: it re-derives the contract
// from the API's documented rules rather than mirroring the normalizer's repair
// passes, so a green matrix is real evidence the normalizer repairs the wedge
// (and not a tautology where the checker only re-states what the producer did).
//
// The contract this encodes (each is a real 400 cause we have hit, see the
// dropOrphanToolMessages / dropDanglingToolCalls notes in the normalizer):
//   - every role:'tool' message answers an OPEN tool_call from the immediately
//     preceding assistant tool_calls run (no orphan, no wrong-id, no answer that
//     arrives after a non-tool message broke the run, no second answer);
//   - every assistant tool_call is answered before the run ends (no dangling);
//   - tool messages carry a non-empty string tool_call_id and string content;
//   - assistant tool_calls are well-formed (id + type:'function' + function.name
//     + string arguments), with no duplicate id inside one turn;
//   - every message has one of the four allowed roles.

export const DEEPSEEK_CONTRACT_VIOLATIONS = Object.freeze({
  // A null / non-object entry in the message list.
  NULL_MESSAGE: 'null_message',
  // role is not one of system | user | assistant | tool.
  INVALID_ROLE: 'invalid_role',
  // A role:'tool' message whose tool_call_id does not match an open (so-far
  // unanswered) call from the immediately preceding assistant tool_calls run.
  // Covers: no preceding assistant tool_calls at all (post-compaction / resume
  // orphan), an unknown id, a result that arrives after a non-tool message broke
  // the run (adjacency), and a duplicate answer to an already-answered call.
  ORPHAN_TOOL_RESULT: 'orphan_tool_result',
  // An assistant tool_call id that is never answered before the run ends (a
  // non-tool message or end-of-list). This permanently wedges a session.
  DANGLING_TOOL_CALL: 'dangling_tool_call',
  // A role:'tool' message missing a usable (non-empty string) tool_call_id.
  TOOL_RESULT_MISSING_ID: 'tool_result_missing_id',
  // A role:'tool' message whose content is not a string (the API requires text).
  TOOL_RESULT_CONTENT_NOT_STRING: 'tool_result_content_not_string',
  // An assistant tool_calls entry that is structurally malformed (missing/empty
  // id, type !== 'function', missing function.name, or non-string arguments).
  TOOL_CALL_MALFORMED: 'tool_call_malformed',
  // Two open tool_calls share an id within one assistant turn — the server cannot
  // route a result deterministically.
  DUPLICATE_TOOL_CALL_ID: 'duplicate_tool_call_id',
})

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool'])

/**
 * Validate a mapped DeepSeek request body's `messages` array against the
 * /chat/completions message contract. Pure and side-effect-free.
 *
 * @param {unknown} messages the mapped message array (mapMessagesToDeepSeek output)
 * @returns {{ valid: boolean, violations: Array<{ code: string, index: number, detail?: string }> }}
 */
export function validateDeepSeekMessageContract(messages) {
  const violations = []
  if (!Array.isArray(messages)) {
    return { valid: false, violations }
  }

  // Open, so-far-unanswered tool_call ids from the current assistant tool run,
  // mapped to the index of the assistant message that opened them (so a dangling
  // call is reported at its opener, not at the boundary that revealed it).
  let pending = new Map()

  const flushPending = () => {
    for (const [id, openerIndex] of pending) {
      violations.push({
        code: DEEPSEEK_CONTRACT_VIOLATIONS.DANGLING_TOOL_CALL,
        index: openerIndex,
        detail: id,
      })
    }
    pending = new Map()
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message || typeof message !== 'object') {
      violations.push({ code: DEEPSEEK_CONTRACT_VIOLATIONS.NULL_MESSAGE, index: i })
      // A hole in the list breaks any open tool run.
      flushPending()
      continue
    }

    const role = message.role
    const roleValid = VALID_ROLES.has(role)
    if (!roleValid) {
      violations.push({
        code: DEEPSEEK_CONTRACT_VIOLATIONS.INVALID_ROLE,
        index: i,
        detail: typeof role === 'string' ? role : String(role),
      })
    }

    // A tool result continues an open run; it is the only role that does not
    // close it. Everything else (system / user / assistant / unknown) is a
    // boundary that must leave no call unanswered.
    if (role === 'tool') {
      const id = message.tool_call_id
      if (typeof id !== 'string' || id === '') {
        violations.push({
          code: DEEPSEEK_CONTRACT_VIOLATIONS.TOOL_RESULT_MISSING_ID,
          index: i,
        })
      } else if (pending.has(id)) {
        pending.delete(id)
      } else {
        violations.push({
          code: DEEPSEEK_CONTRACT_VIOLATIONS.ORPHAN_TOOL_RESULT,
          index: i,
          detail: id,
        })
      }
      if (typeof message.content !== 'string') {
        violations.push({
          code: DEEPSEEK_CONTRACT_VIOLATIONS.TOOL_RESULT_CONTENT_NOT_STRING,
          index: i,
        })
      }
      continue
    }

    // Non-tool message: close out the previous run before opening any new one.
    flushPending()

    if (role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const id = call && typeof call === 'object' ? call.id : undefined
        const idUsable = typeof id === 'string' && id !== ''
        const shapeOk =
          call &&
          typeof call === 'object' &&
          call.type === 'function' &&
          call.function &&
          typeof call.function === 'object' &&
          typeof call.function.name === 'string' &&
          typeof call.function.arguments === 'string'
        if (!idUsable || !shapeOk) {
          violations.push({
            code: DEEPSEEK_CONTRACT_VIOLATIONS.TOOL_CALL_MALFORMED,
            index: i,
            detail: idUsable ? id : undefined,
          })
        }
        if (!idUsable) {
          // Untrackable — can never be paired, so don't add it to `pending`
          // (that would mis-report it as dangling on top of malformed).
          continue
        }
        if (pending.has(id)) {
          violations.push({
            code: DEEPSEEK_CONTRACT_VIOLATIONS.DUPLICATE_TOOL_CALL_ID,
            index: i,
            detail: id,
          })
          continue
        }
        pending.set(id, i)
      }
    }
  }

  // Anything still open at end-of-list is dangling.
  flushPending()

  return { valid: violations.length === 0, violations }
}
