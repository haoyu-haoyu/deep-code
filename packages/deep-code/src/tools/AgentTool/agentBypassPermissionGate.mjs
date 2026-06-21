/**
 * Drop an agent-definition-supplied `bypassPermissions` permission mode when the
 * managed bypass killswitch is active.
 *
 * An agent definition (frontmatter `permissionMode:`) may request
 * `bypassPermissions`. The main session honors the managed killswitch
 * (settings.permissions.disableBypassPermissionsMode === 'disable' OR the
 * tengu_disable_bypass_permissions_mode gate) when it computes
 * isBypassPermissionsModeAvailable and when it applies a setMode
 * (permissionSetup.ts) — so a bypass-disabled session can never itself reach
 * bypassPermissions. But the per-subagent permissionMode override read from an
 * agent definition (runAgent.ts / resumeAgent.ts / AgentTool.tsx) did NOT
 * re-check the killswitch, so ANY agent definition — including a folder-trusted
 * workspace `.claude/agents/*.md` — could silently run a subagent in full
 * bypass and defeat the admin control per-subagent.
 *
 * This mirrors the sibling agent-definition capability gates: mcpServers
 * (runAgent.ts ~114) and hooks (runAgent.ts ~556) honor the relevant managed
 * lockdown (isRestrictedToPluginOnly) before applying an agent's escalating
 * capability. The bypass killswitch is the managed lockdown for
 * bypassPermissions.
 *
 * The gate ONLY removes a disabled bypass; it never elevates. Every other mode
 * — acceptEdits / plan / default / dontAsk / auto / bubble — and an `undefined`
 * input pass through unchanged. Returns `undefined` when the requested mode was
 * `bypassPermissions` and the killswitch is active; callers treat `undefined`
 * as "do not apply this override" (the parent / resume-default mode stands,
 * which is non-bypass).
 *
 * @param {import('../../utils/permissions/PermissionMode.js').PermissionMode | undefined} agentPermissionMode - the mode the agent definition requests
 * @param {boolean} bypassPermissionsDisabled - true when the managed bypass killswitch is active
 * @returns {import('../../utils/permissions/PermissionMode.js').PermissionMode | undefined} the mode to apply, or undefined to skip the override
 */
export function gateAgentBypassPermissionMode(
  agentPermissionMode,
  bypassPermissionsDisabled,
) {
  if (
    agentPermissionMode === 'bypassPermissions' &&
    bypassPermissionsDisabled
  ) {
    return undefined
  }
  return agentPermissionMode
}
