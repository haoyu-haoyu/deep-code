// Order the enabled setting sources by CANONICAL precedence, not by the order
// they happened to be enabled in.
//
// Settings sources are merged later-wins (loadSettingsFromDisk / permissionsLoader
// iterate this list and a later source overrides an earlier one), so the ARRAY
// ORDER is the precedence. `policySettings` (enterprise managed-settings.json) must
// merge LAST so it can never be overridden, and `flagSettings` (--settings <file>)
// must sit just before it; user < project < local is the canonical base order.
//
// Building the list from a Set of the *enabled* sources plus `.add('policySettings')`
// / `.add('flagSettings')` yields Set-INSERTION order: in the default path the
// allowed list is already canonical so it happens to be correct, but as soon as
// `--setting-sources` narrows or reorders the allowed list, the two appended
// sources land at the END — placing flagSettings AFTER policySettings (a CLI user's
// --settings file then overrides enterprise managed policy, a fail-open of
// disableBypassPermissionsMode / defaultMode) and letting user/project/local follow
// whatever order was typed. Filtering the canonical order by membership fixes both:
// every present source keeps its canonical rank regardless of how it was enabled.
//
// Default path (all sources allowed, already canonical) is byte-identical to the
// previous Set-insertion output, so behavior only changes when --setting-sources
// is in play.
export function orderEnabledSettingSources(allowed, canonicalOrder) {
  const enabled = new Set(allowed)
  // policy + flag are always enabled, independent of --setting-sources.
  enabled.add('policySettings')
  enabled.add('flagSettings')
  return canonicalOrder.filter(source => enabled.has(source))
}
