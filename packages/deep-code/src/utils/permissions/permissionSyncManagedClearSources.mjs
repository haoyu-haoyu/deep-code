// The MANAGED permission-rule sources syncPermissionRulesFromDisk must clear
// (across allow/deny/ask) before re-applying — IN ADDITION to the editable disk
// sources (userSettings/projectSettings/localSettings) it already clears.
//
// syncPermissionRulesFromDisk re-applies loadAllPermissionRulesFromDisk()'s rules
// via convertRulesToUpdates(..., 'replaceRules'), which emits a replaceRules ONLY
// for a source:behavior pair that still has >=1 rule. So a source whose LAST
// allow/ask/deny rule was removed on disk produces no update — and unless that
// source is cleared here first, the context keeps the OLD (revoked) rule and
// keeps honoring it at runtime. The editable disk sources are already cleared for
// exactly this reason; policySettings and flagSettings were left out, so removing
// an admin's managed grant (or a launch-time --settings grant) mid-session left a
// stale, still-enforced rule until restart — a fail-open toward the admin's
// intent. getAllowRules/getAskRules read policySettings/flagSettings even under
// the allowManagedPermissionRulesOnly lockdown, and getDenyRules reads every
// source, so the stale rule is genuinely live. Same clear-set-vs-reapply-set
// drift #661 fixed for the editable sources.
//
// A source is returned here ONLY when it is also re-applied, so no rule is ever
// dropped:
//   - policySettings is ALWAYS re-loaded (loadAllPermissionRulesFromDisk returns
//     policySettings in BOTH modes), so it is always safe to clear.
//   - flagSettings is re-loaded ONLY when the lockdown is OFF (under lockdown
//     loadAllPermissionRulesFromDisk short-circuits to policySettings ONLY).
//     Clearing flagSettings under lockdown would permanently drop the owner's
//     launch-time --settings grant with nothing to re-apply it, so it is omitted
//     under lockdown (where it is frozen at its initial-load value, exactly as
//     loadAllPermissionRulesFromDisk leaves it).
//
// @param {boolean} lockdownActive shouldAllowManagedPermissionRulesOnly()
// @returns {Array<'policySettings' | 'flagSettings'>} managed sources to clear
export function permissionSyncManagedClearSources(lockdownActive) {
  return lockdownActive
    ? ['policySettings']
    : ['policySettings', 'flagSettings']
}
