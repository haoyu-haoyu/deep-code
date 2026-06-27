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
 * `mcpInfoFromString` is injected so this stays a pure, node-testable leaf.
 *
 * @param {string} ruleToolName  the tool-wide rule's toolName (no ruleContent)
 * @param {string} toolName      the tool / specific-rule toolName to test against
 * @param {(s: string) => ({ serverName: string, toolName: string | undefined } | null)} mcpInfoFromString
 * @returns {boolean}
 */
export function toolWideRuleNameMatches(ruleToolName, toolName, mcpInfoFromString) {
  // Direct tool name match.
  if (ruleToolName === toolName) {
    return true
  }
  // MCP server-level permission: rule "mcp__server1" matches tool
  // "mcp__server1__tool1"; wildcard "mcp__server1__*" matches all tools of server1.
  const ruleInfo = mcpInfoFromString(ruleToolName)
  const toolInfo = mcpInfoFromString(toolName)
  return (
    ruleInfo !== null &&
    toolInfo !== null &&
    (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') &&
    ruleInfo.serverName === toolInfo.serverName
  )
}
