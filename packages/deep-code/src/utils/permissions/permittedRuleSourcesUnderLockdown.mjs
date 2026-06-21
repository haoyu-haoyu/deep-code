// Which permission-rule SOURCES may still grant a tool when an admin has set
// allowManagedPermissionRulesOnly (policySettings). Under that lockdown only the
// admin's managed (policySettings) rules — plus the owner's launch-time
// --settings (flagSettings) rules — should take effect; every other source is
// neutralized.
//
// syncPermissionRulesFromDisk already clears the disk sources (userSettings,
// projectSettings, localSettings) and the in-memory cliArg + session sources from
// the context under the lockdown. But the 'command' source — a project/plugin
// slash-command frontmatter `allowed-tools` self-grant — canNOT be cleared that
// way: it is NOT a PermissionUpdateDestination (so applyPermissionUpdate can't
// target it) and it is re-injected fresh into alwaysAllowRules.command every turn
// (REPL re-render, forked agents, plugin command load). Left un-gated, the LEAST
// trusted, workspace/plugin-controlled source would auto-allow tools past an admin
// security control — the exact bypass the cliArg/session scrub already closes for
// the more-trusted in-memory sources. So the resolver (getAllowRules/getAskRules,
// the single point both the whole-tool and per-content match consume) must drop
// 'command' too under the lockdown. Deny rules are intentionally NOT gated here —
// a deny is more restrictive, so dropping one could only loosen, never tighten.
//
// The cleared set mirrors syncPermissionRulesFromDisk's sourcesToClear exactly
// (userSettings/projectSettings/localSettings/cliArg/session) PLUS 'command', so
// the permitted set is {flagSettings, policySettings} — no new policy is invented
// about flagSettings, which the existing scrub already preserves.
const SOURCES_CLEARED_UNDER_LOCKDOWN = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
  'cliArg',
  'session',
  'command',
])

// `allSources` is the full PERMISSION_RULE_SOURCES list; `managedOnly` is
// shouldAllowManagedPermissionRulesOnly(). Returns the same array (order
// preserved) when the lockdown is off, else the subset that survives it. The
// generic preserves the element (source) type for the .ts caller.
/**
 * @template {string} S
 * @param {readonly S[]} allSources
 * @param {boolean} managedOnly
 * @returns {readonly S[]}
 */
export function permittedRuleSourcesUnderLockdown(allSources, managedOnly) {
  if (!managedOnly) return allSources
  return allSources.filter(source => !SOURCES_CLEARED_UNDER_LOCKDOWN.has(source))
}
