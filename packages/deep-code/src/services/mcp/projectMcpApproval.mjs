// Decide a project (.mcp.json) MCP server's approval status from settings.
//
// SECURITY: the ENABLE signal (enableAllProjectMcpServers / enabledMcpjsonServers)
// is honored ONLY from TRUSTED sources — never the workspace projectSettings
// (a repo's committed .claude/settings.json). Reading it from MERGED settings let
// an opened repo self-approve its own .mcp.json server and, after folder-trust,
// zero-click-connect it (stdio command spawn / env-expanded ${SECRET}-into-URL)
// past the per-server MCPServerApprovalDialog. This mirrors hasSkipDangerousMode
// PermissionPrompt / hasAutoModeOptIn, which read the same {userSettings,
// localSettings, flagSettings, policySettings} set and exclude projectSettings so
// "a malicious project can't control this (RCE risk)". The legitimate approval
// dialog writes these keys to localSettings, so excluding projectSettings does NOT
// break a real approval.
//
// The DISABLE signal (disabledMcpjsonServers) is read from MERGED settings
// (fail-closed: a repo can only DENY its own server, which is harmless).
//
// Pure value-in/value-out (inputs are pre-normalized name lists + flags) so the
// decision is node-testable; the wrapper in utils.ts reads getSettingsForSource.
// Returns 'rejected' | 'approved' | 'pending' — 'pending' means the enable/disable
// signals didn't decide, and the caller falls through to its bypass/non-interactive
// checks.
export function resolveProjectMcpServerStatus({
  targetName,
  disabledNamesMerged,
  enabledNamesTrusted,
  enableAllTrusted,
}) {
  if (disabledNamesMerged.includes(targetName)) return 'rejected'
  if (enableAllTrusted || enabledNamesTrusted.includes(targetName)) {
    return 'approved'
  }
  return 'pending'
}
