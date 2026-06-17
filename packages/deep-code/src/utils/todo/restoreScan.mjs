// Pick the TodoWrite list to restore from a resumed transcript.
//
// The live TodoWrite tool is NOT concurrency-safe: when a turn issues several
// TodoWrite calls the StreamingToolExecutor runs them serially (last-wins), and
// a schema-invalid call produces an is_error tool_result WITHOUT mutating app
// state. So the list the live session actually held is the result of the LAST
// TodoWrite call whose input PARSED — equivalently, scanning the transcript's
// tool_use blocks newest-first, the FIRST one that parses.
//
// This replaces an earlier scan that (a) took the FIRST TodoWrite block in a
// message (`Array.find`) — wrong when a turn issues several, since the last
// one wins live — and (b) returned an empty list the moment the most-recent
// TodoWrite was malformed, discarding an earlier valid list the live session
// still tracked. A malformed block is now skipped and the scan continues to
// earlier blocks; a successful parse (including one that collapses to [] for a
// fully-completed list, preserving the resume-collapse behavior) wins.
//
// Scanning a single flattened emission-order list is equivalent to a
// per-message backward scan: blocks keep their within-message order, so the
// newest-first walk picks the last successfully-parsed block whether the
// competing blocks live in the same turn or in different ones.
//
/**
 * @template T
 * @param {ReadonlyArray<{ name: string, input: unknown }>} toolUseBlocks
 *   all assistant tool_use blocks in transcript (oldest-first) emission order.
 * @param {string} todoWriteToolName the TodoWrite tool name to match.
 * @param {(input: unknown) => { ok: true, todos: T } | { ok: false }} parseTodos
 *   parse a block's input into a (collapsed) todo list, or signal that it was
 *   malformed / schema-invalid.
 * @returns {T | []} the restored list, or [] when no TodoWrite block parsed.
 */
export function selectRestoredTodos(
  toolUseBlocks,
  todoWriteToolName,
  parseTodos,
) {
  for (let i = toolUseBlocks.length - 1; i >= 0; i--) {
    const block = toolUseBlocks[i]
    if (block.name !== todoWriteToolName) {
      continue
    }
    const result = parseTodos(block.input)
    if (result.ok) {
      return result.todos
    }
  }
  return []
}
