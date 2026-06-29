// Bypass-immune decisionReason for a bash path-SAFETY ask.
//
// Several asks in BashTool/pathValidation.ts guard bash patterns that defeat the
// STATIC path resolver — a `cd` that moves the effective cwd before a write, flags
// (`mv --target-directory=…`) that hide the real target, process substitution or a
// `$VAR`/`%VAR%` redirect target that can't be resolved at all — or that name a
// catastrophic resolved path (`rm -rf /`). Their own messages promise the command
// "requires manual approval" / "cannot be auto-allowed by permission rules".
//
// They previously emitted `decisionReason.type: 'other'`, which
// resolvePermissionPrecedence maps to the plain `continue` slot — so a tool-wide
// `allow: ["Bash"]` rule, bypassPermissions mode, or a PreToolUse hook could
// silently downgrade them to ALLOW. That is exactly the bypass these guards exist
// to prevent: a DIRECT write to `.claude/settings.json` is already immune (it goes
// through the sensitive-file safety check, type 'safetyCheck'), yet the same write
// reached via `cd .claude && echo x > settings.json` slipped through.
//
// Emitting `type: 'safetyCheck'` instead routes the ask to the bypass-immune
// `safety-check-ask` slot (resolvePermissionPrecedence step 1g), and — for the
// compound form flattened to `subcommandResults` — is recognised as bypass-immune
// by compoundAskIsBypassImmune. The message-builder (permissions.ts) handles
// 'safetyCheck' identically to 'other', so the user-facing prompt is unchanged.
//
// `classifierApprovable` (consumed by permissions.ts in auto/headless mode) decides
// whether the auto-mode AI classifier may still evaluate the ask:
//
//   - bashPathSafetyAskReason → classifierApprovable: TRUE. For guards whose target
//     the classifier can read straight from the command text and reason about — a
//     `cd`/flagged write. This mirrors the DIRECT sensitive-file guard
//     (filesystem.ts, classifierApprovable: true) so the indirect (cd/flag) form is
//     never STRICTER than writing the same file directly, and a benign
//     `cd src && echo x > foo.ts` is not hard-denied in headless/auto.
//
//   - bashUnresolvableSafetyAskReason → classifierApprovable: FALSE. For a target
//     the classifier cannot resolve either — process substitution runs an arbitrary
//     command whose writes evade redirect detection, a `$VAR` redirect target is
//     dynamic — or a catastrophic resolved path. Like a suspicious-Windows-path
//     bypass (filesystem.ts, classifierApprovable: false) it must not be
//     auto-approved by ANY path, the classifier included.
//
// Pure value-in/value-out so the shape — and its routing through
// resolvePermissionPrecedence — is node-testable.

/**
 * @param {string} reason
 * @param {boolean} classifierApprovable
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
function bashSafetyCheckReason(reason, classifierApprovable) {
  return { type: 'safetyCheck', reason, classifierApprovable }
}

/**
 * Bypass-immune ask whose target the auto-mode classifier MAY still evaluate
 * (a `cd`/flagged write — mirrors the direct sensitive-file guard).
 * @param {string} reason
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
export function bashPathSafetyAskReason(reason) {
  return bashSafetyCheckReason(reason, true)
}

/**
 * Bypass-immune ask that is classifier-IMMUNE too — a genuinely unresolvable
 * target (process substitution, a `$VAR` redirect) or a catastrophic resolved path.
 * @param {string} reason
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
export function bashUnresolvableSafetyAskReason(reason) {
  return bashSafetyCheckReason(reason, false)
}
