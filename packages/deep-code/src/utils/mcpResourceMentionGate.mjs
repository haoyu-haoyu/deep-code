// Whether an @server:uri MCP-resource mention should be SUPPRESSED (dropped,
// not read) given the user's configured permission rules for ReadMcpResourceTool.
//
// Why: attachment expansion runs silently BEFORE the turn — it cannot show a
// permission prompt — so the sibling @-file path (processAtMentionedFiles via
// isFileReadDenied) drops a mention on a `deny` OR a non-workingDir `ask`
// decision rather than read un-prompted. The MCP-resource @-mention path had NO
// such gate, so a user's configured deny/ask rule on ReadMcpResourceTool was
// silently bypassed (and an untrusted skill body's @-mention auto-read a resource
// the user never typed). This restores parity.
//
// There is no working-directory analog for an MCP resource, so ANY matched rule
// (deny or ask) suppresses — unlike the @-file path's workingDir carve-out. By
// default (no rule) both args are null → not suppressed → the resource is read,
// exactly as before (no regression for the common, un-configured case).
//
// Pure value-in/value-out so the deny-OR-ask suppression invariant is testable
// without the .ts permission context (attachments.ts is bun-tainted).
//
// @param {{ denyRule: unknown, askRule: unknown }} rules  the resolved
//   getDenyRuleForTool / getAskRuleForTool results (a PermissionRule or null)
// @returns {boolean} true => drop the mention without reading
export function isMcpResourceMentionSuppressed({ denyRule, askRule } = {}) {
  return denyRule != null || askRule != null
}
