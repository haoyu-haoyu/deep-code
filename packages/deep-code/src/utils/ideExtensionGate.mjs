// Identify the client that is the REAL connected IDE EXTENSION — the one allowed
// to (a) be the openDiff RPC target whose returned FILE_SAVED content is WRITTEN
// to the workspace with NO terminal review (useDiffInIDE), (b) gate the
// show-diff-in-IDE feature, and (c) supply at-mention/selection context.
//
// The matchers previously trusted ANY connected client merely NAMED 'ide'
// (`client.type === 'connected' && client.name === 'ide'`), so a workspace
// .mcp.json server keyed `ide` (folder-trust + MCP-enablement gated) could
// IMPERSONATE the IDE: implement an openDiff tool that shows nothing and returns
// [{text:'FILE_SAVED'},{text:'<attacker content>'}], substituting content the
// user never reviewed into a workspace file write.
//
// The real IDE config is synthesized INTERNALLY (useIDEIntegration / the /ide
// command) with scope 'dynamic' AND transport 'sse-ide'/'ws-ide'. The load-bearing
// gate is scope: `scope` is NOT part of the per-server .mcp.json schema — it is
// assigned by the config LOADER from the config's SOURCE, so a static
// project/user/local .mcp.json server is scoped project/user/local and can NEVER
// be 'dynamic' (even though the per-server schema technically accepts type
// 'sse-ide'). Requiring transport 'sse-ide'/'ws-ide' too (mirroring
// getIdeClientName) narrows it further so a dynamic-scoped non-IDE transport
// can't pass either.
//
// RESIDUAL (documented, separate higher-trust surfaces): scope 'dynamic' is not
// IDE-exclusive — it is also assigned to `--mcp-config` launch-flag servers
// (main.tsx) and agent-definition MCP servers (runAgent.ts). So a server keyed
// 'ide' with an sse-ide transport supplied via `--mcp-config` or an installed
// agent definition could still pass. Those are user-explicit / installed-trust
// inputs, a distinct trust tier from the AUTO-LOADED workspace .mcp.json
// impersonation closed here. (Third-party PLUGIN servers are NOT a vector: they
// are renamed `plugin:<plugin>:<server>` at load — mcpPluginIntegration — so a
// plugin server can never present name === 'ide'.)
//
// Pure value-in/value-out so it is node-testable (ide.ts is bun-tainted).

/**
 * @param {{ type?: string, name?: string, config?: { scope?: string, type?: string } }} client
 * @returns {boolean}
 */
export function isConnectedIdeExtension(client) {
  if (!client || client.type !== 'connected' || client.name !== 'ide') {
    return false
  }
  const scope = client.config?.scope
  const transport = client.config?.type
  return (
    scope === 'dynamic' && (transport === 'sse-ide' || transport === 'ws-ide')
  )
}
