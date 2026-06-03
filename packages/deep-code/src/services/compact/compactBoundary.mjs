// Compaction boundary alignment — pure + unit-testable under `node --test`
// (compact.ts is bun/React-coupled).
//
// SECURITY/CORRECTNESS: when partialCompactConversation's keep/summarize split
// lands BETWEEN an assistant tool_use and its following tool_result, the result
// is an ORPHAN tool_result (or a dangling tool_use) at the boundary. That
// breaks DeepSeek's strict tool_call↔tool_result pairing AND mutates the stable
// prefix (the kept tail no longer byte-matches the prior turn), collapsing the
// prompt-cache moat. Reasonix guards this in compactBounds() by walking the keep
// boundary BACKWARD over tool messages; this is the TS/Ink equivalent.
//
// The same backward walk fixes BOTH directions:
//   - 'up_to' keeps slice(pivotIndex): if messages[pivotIndex] is a tool_result,
//     its tool_use was summarized → orphan in the kept tail. Walking pivotIndex
//     back onto the assistant keeps the pair together in the kept tail.
//   - 'from' keeps slice(0, pivotIndex): if messages[pivotIndex] is a
//     tool_result, the kept head ends with a dangling tool_use. Walking back
//     moves the whole exchange into the summarized portion; the kept head ends
//     clean.

/**
 * Is this a tool_result-bearing message (a user message whose content array
 * contains a tool_result block)? Mirrors isToolResultMessage in
 * src/utils/messages.ts (kept here as a tiny pure copy so this core has no
 * bun-tainted import).
 * @param {any} msg
 * @returns {boolean}
 */
export function messageIsToolResult(msg) {
  if (!msg || msg.type !== 'user') return false
  const content = msg.message?.content
  if (!Array.isArray(content)) return false
  return content.some(block => block && block.type === 'tool_result')
}

/**
 * Move a compaction keep/summarize boundary BACKWARD off any tool_result
 * messages so it never splits a tool_use↔tool_result pair. Returns the aligned
 * index (<= pivotIndex). Stops at the first non-tool-result message (the
 * assistant that issued the tool_calls) or at index 0.
 * @param {readonly any[]} messages
 * @param {number} pivotIndex
 * @returns {number}
 */
export function alignCompactBoundaryBackward(messages, pivotIndex) {
  let i = pivotIndex
  while (i > 0 && messageIsToolResult(messages[i])) {
    i--
  }
  return i
}
