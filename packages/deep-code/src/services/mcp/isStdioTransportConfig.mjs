// Whether an MCP server config describes a stdio (child-process) transport.
//
// `type` is OPTIONAL in the config schema (types.ts: `z.literal('stdio')
// .optional()`, kept for backwards compatibility) — the canonical `.mcp.json` /
// claude_desktop_config.json form is a bare `{command, args, env}` with NO type
// field, which parses to `type: undefined`. So a stdio server is one that is
// EITHER explicitly `'stdio'` OR has no type at all.
//
// This is the single source of truth for that predicate across the connect /
// cleanup lifecycle (spawn, stderr wiring/teardown, and child signal
// escalation). Those sites previously inlined `type === 'stdio' || !type`
// independently, and the signal-escalation gate drifted to a STRICT
// `type === 'stdio'` — so a typeless stdio child was spawned but never received
// the SIGINT→SIGTERM→SIGKILL graceful-shutdown escalation, falling back to the
// SDK's slower close(). Routing every gate through this predicate makes that
// divergence impossible.
//
// NOTE: this is intentionally NARROWER than isLocalMcpServer(), which also
// returns true for `type: 'sdk'` (in-process servers with no child pid that must
// NOT receive OS signals). Use `!type` (not `type == null`) to match the inline
// gates exactly: an empty-string type is treated as "no type" by both.
//
// @param {string | null | undefined} type  the server config's `type` field
// @returns {boolean}
export function isStdioTransportConfig(type) {
  return type === 'stdio' || !type
}
