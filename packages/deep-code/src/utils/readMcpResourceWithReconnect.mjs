// Read an MCP resource, refreshing a stale transport first.
//
// @-mention resource reads (`@server:uri`) used to call `readResource` on the
// client captured in the tool-use context SNAPSHOT. If the MCP server has
// reconnected since that snapshot was taken (transport torn down and
// re-established), the snapshot client's transport is dead and the read throws
// — so the @-mentioned resource is silently dropped from the turn.
//
// Every other resource-read site refreshes the connection first via
// `ensureConnectedClient` (ReadMcpResourceTool, and the prompt/resource reads in
// services/mcp/client.ts). This routes the @-mention path through the same
// refresh so a reconnected server is picked up instead of failing the read.
//
// `ensureConnected` is injected (the .ts caller passes the real
// `ensureConnectedClient`) so this leaf is unit-testable without the MCP SDK.
//
/**
 * @param {{ client: { readResource(args: { uri: string }): Promise<unknown> } }} client
 *   the snapshot connected-server handle.
 * @param {string} uri the resource URI to read.
 * @param {(client: any) => Promise<{ client: { readResource(args: { uri: string }): Promise<any> } }>} ensureConnected
 *   resolves a freshly-connected handle for `client` (reconnecting if needed).
 * @returns {Promise<any>} the ReadResourceResult from the refreshed client.
 */
export async function readMcpResourceWithReconnect(client, uri, ensureConnected) {
  const connected = await ensureConnected(client)
  return connected.client.readResource({ uri })
}
