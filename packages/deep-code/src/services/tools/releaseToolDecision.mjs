/**
 * Release the per-tool permission-decision entry once a tool use has reached a
 * terminal state.
 *
 * A tool's permission decision (approve OR reject) is recorded in
 * `toolUseContext.toolDecisions` by logPermissionDecision and read back during
 * result logging (decision source/type on the tool_result OTel event). Once the
 * tool use is finished the entry must be deleted, otherwise the map grows for
 * the lifetime of the (per-session) toolUseContext.
 *
 * checkPermissionsAndCallTool deletes it in its `finally` on the allow/execute
 * path — but the permission-DENY path `return`s BEFORE that try/finally is
 * entered, so without an explicit release every interactively denied tool leaks
 * its entry. This is exactly the cleanup the finally performs, factored out so
 * both terminal paths share one implementation.
 *
 * Safe when the map was never lazily created (undefined) or the id was never
 * recorded — `Map.delete` is a no-op for an absent key, and only the targeted
 * key is removed so sibling tools in a concurrent batch are untouched.
 *
 * @param {Map<string, unknown> | undefined} toolDecisions  toolUseContext.toolDecisions
 * @param {string} toolUseID
 * @returns {boolean} whether an entry was actually removed
 */
export function releaseToolDecision(toolDecisions, toolUseID) {
  return toolDecisions?.delete(toolUseID) ?? false
}
