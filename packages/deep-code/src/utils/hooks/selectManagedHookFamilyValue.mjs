// statusLine.command and fileSuggestion.command are hook-EQUIVALENTS: each runs a
// shell command via execCommandHook to render the status bar / file-suggestion
// list. They are standalone settings keys (NOT members of the `hooks` map), but the
// codebase already treats them as the hook family for two of the three managed
// hook-family controls — disableAllHooks ("Disable all hooks and statusLine
// execution") gates them upstream, and allowManagedHooksOnly narrows them to the
// managed (policySettings) value. The THIRD control, strictPluginOnlyCustomization
// on the 'hooks' surface (isRestrictedToPluginOnly('hooks')), was MISSED: the two
// executors read the MERGED settings (which include a workspace-controlled project /
// local .claude/settings.json) without that check. So an admin's plugin-only
// lockdown — which correctly blocks a project `hooks` map (getHooksFromAllowedSources
// returns only policySettings.hooks) — was bypassed by a project statusLine /
// fileSuggestion command.
//
// This selects the managed-only (policySettings) value when EITHER managed lockdown
// is active, mirroring getHooksFromAllowedSources; otherwise the merged value (the
// byte-identical legacy/no-policy behavior). A managed (admin-authored) statusLine /
// fileSuggestion still runs.
export function selectManagedHookFamilyValue({
  managedOnly,
  pluginOnlyLocked,
  policyValue,
  mergedValue,
}) {
  return managedOnly || pluginOnlyLocked ? policyValue : mergedValue
}
