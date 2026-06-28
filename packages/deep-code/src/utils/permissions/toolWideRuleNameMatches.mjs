/**
 * Whether a TOOL-WIDE permission rule named `ruleToolName` (i.e. one with no
 * ruleContent) applies to a tool — or a more specific rule's tool — named
 * `toolName`. This is the NAME-matching half of toolMatchesRule (permissions.ts):
 *
 *   - a direct name match (`Bash` rule ↔ `Bash` tool), OR
 *   - an MCP server-level rule (`mcp__server`) or server wildcard
 *     (`mcp__server__*`) matching any tool of that server (`mcp__server__tool`).
 *
 * Extracted as a single source of truth so the runtime matcher (toolMatchesRule)
 * and the unreachable-rule DIAGNOSTIC (shadowedRuleDetection) cannot drift. The
 * diagnostic previously compared rule names with plain `===` equality, so it
 * never reported an MCP server-level deny/ask rule (e.g. `mcp__github`) as
 * shadowing a tool-specific allow rule (e.g. `mcp__github__create_issue(*)`),
 * even though the runtime correctly denies/asks it — the user was wrongly told
 * the allow rule was reachable.
 *
 * `mcpInfoFromString` and `normalizeNameForMCP` are injected so this stays a
 * pure, node-testable leaf.
 *
 * SECURITY — normalization symmetry. A TOOL's matchable name is built
 * component-wise with normalizeNameForMCP (buildMcpToolName: server 'foo.bar'
 * becomes 'mcp__foo_bar__tool'), but a permission RULE string is the user's RAW
 * text. Comparing them raw, `mcp__foo.bar` (serverName 'foo.bar') never equals
 * the tool's 'foo_bar', so the rule silently fails to match — fail-OPEN for a
 * DENY (the denied MCP tool runs and stays visible to the model), and a dropped
 * allow/ask otherwise — for any server name containing a character
 * normalizeNameForMCP rewrites (dot, space, …, e.g. a 'claude.ai Canva' server).
 * Normalizing both sides per-component (exactly as buildMcpToolName does) closes
 * that gap for server-level, server-wildcard, AND per-tool rules.
 *
 * @param {string} ruleToolName  the tool-wide rule's toolName (no ruleContent)
 * @param {string} toolName      the tool / specific-rule toolName to test against
 * @param {(s: string) => ({ serverName: string, toolName: string | undefined } | null)} mcpInfoFromString
 * @param {(name: string) => string} normalizeNameForMCP
 * @returns {boolean}
 */
export function toolWideRuleNameMatches(
  ruleToolName,
  toolName,
  mcpInfoFromString,
  normalizeNameForMCP,
) {
  // Fast path: an already-normalized direct match (and the only path for
  // non-MCP tools, where mcpInfoFromString returns null).
  if (ruleToolName === toolName) {
    return true
  }
  const ruleInfo = mcpInfoFromString(ruleToolName)
  const toolInfo = mcpInfoFromString(toolName)
  if (ruleInfo === null || toolInfo === null) {
    return false
  }
  // Server names must match after the SAME per-component normalization the tool
  // name was built with (the tool side is already normalized; this normalizes
  // the raw rule side too).
  if (
    normalizeNameForMCP(ruleInfo.serverName) !==
    normalizeNameForMCP(toolInfo.serverName)
  ) {
    return false
  }
  // Server-level rule ("mcp__server") or server wildcard ("mcp__server__*")
  // matches every tool of that server.
  if (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') {
    return true
  }
  // Per-tool rule ("mcp__server__tool") matches the specific tool by its
  // normalized name (the fast path above already covered the all-normalized
  // case; this adds the raw-name form).
  return (
    toolInfo.toolName !== undefined &&
    normalizeNameForMCP(ruleInfo.toolName) ===
      normalizeNameForMCP(toolInfo.toolName)
  )
}
