// Whether a coalesced MCP server update should be applied when the ~16ms batch
// flush finally runs (flushPendingUpdates in useManageMCPConnections.ts).
//
// The bug: updateServer buffers a server update and arms a setTimeout; the flush
// applies each buffered update by name with NO re-check of the disk truth. A
// tools/prompts/resources `list_changed` handler closes over the connected
// client and, after an in-flight `await fetch*ForClient`, calls
// updateServer({...client /* connected */, tools}). If the user DISABLES that
// server via /mcp during that await window, the disable lands first
// (setMcpServerEnabled writes disk + flushes a {type:'disabled'} update), but
// then the late connected update flushes and RESURRECTS the server as
// 'connected' with live, model-invokable tools — contradicting the on-disk
// disabled flag. (Same shape resurrects a server removed by a .mcp.json edit /
// /reload-plugins.)
//
// Fix: at flush time, re-check the disk disabled flag (the same source of truth
// onclose already consults). A NON-TERMINAL update (connected/pending/…) for a
// server that is disabled on disk is a stale resurrection — skip it. Terminal
// states ('disabled'/'failed') always apply: that's how the disable itself lands
// and how teardown/failure is recorded. A re-ENABLED server is not disabled on
// disk, so its connect update applies normally (no regression).
//
// Pure value-in/value-out (isDisabledOnDisk injected) so the gate is node-
// testable without the React hook.
//
// @param {{ type?: string, name?: unknown }} update  the buffered server update
// @param {(name: string) => boolean} isDisabledOnDisk
// @returns {boolean} true => apply the update; false => skip (drop it)
export function shouldApplyPendingMcpUpdate(update, isDisabledOnDisk) {
  // Malformed / nameless update: don't silently drop — let the caller handle it
  // as before (defensive; the live producer always sets a name).
  if (!update || typeof update.name !== 'string') return true

  // Terminal states always apply (the disable's own update, and failures).
  if (update.type === 'disabled' || update.type === 'failed') return true

  // A non-terminal update for a server disabled on disk is a stale resurrection.
  return !isDisabledOnDisk(update.name)
}
