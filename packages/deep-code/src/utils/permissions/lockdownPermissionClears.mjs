// Behaviors cleared from the non-managed permission sources when the
// allowManagedPermissionRulesOnly lockdown is active. Only GRANT behaviors are
// neutralized — 'deny' is intentionally EXCLUDED.
const GRANT_BEHAVIORS_UNDER_LOCKDOWN = ['allow', 'ask']

/**
 * The (source, behavior) clear operations syncPermissionRulesFromDisk should
 * apply when re-syncing permission rules under the allowManagedPermissionRulesOnly
 * lockdown. Returns [] when the lockdown is off.
 *
 * Under the lockdown only the admin's managed (policySettings) + the owner's
 * launch-time --settings (flagSettings) rules may GRANT a tool, so the grant
 * (allow/ask) rules of every other source are neutralized. 'deny' is
 * deliberately NOT cleared: a deny only ever tightens, so dropping one could only
 * LOOSEN security. This mirrors permittedRuleSourcesUnderLockdown, whose comment
 * states "Deny rules are intentionally NOT gated here."
 *
 * A prior version cleared 'deny' too. Because cliArg and session are NOT disk
 * sources, they are never re-applied after the clear — so a --disallow-tools (cliArg)
 * or a runtime session deny was silently DROPPED on the next settings change while
 * the lockdown was active, re-allowing a tool the launcher/user had denied. (Disk
 * sources' deny rules are unaffected either way: syncPermissionRulesFromDisk
 * separately clears and re-applies them from disk.)
 *
 * @param {ReadonlyArray<string>} sources  the non-managed sources to neutralize
 * @param {boolean} lockdownActive         shouldAllowManagedPermissionRulesOnly()
 * @returns {Array<{ source: string, behavior: 'allow' | 'ask' }>}
 */
export function lockdownPermissionClears(sources, lockdownActive) {
  if (!lockdownActive) return []
  const ops = []
  for (const source of sources) {
    for (const behavior of GRANT_BEHAVIORS_UNDER_LOCKDOWN) {
      ops.push({ source, behavior })
    }
  }
  return ops
}
