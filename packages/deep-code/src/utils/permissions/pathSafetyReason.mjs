// Bypass-immune decisionReason for a path-resolution-bypass SAFETY ask.
//
// Several asks across the shell path validators guard patterns that defeat STATIC
// path resolution and so create a TOCTOU gap — what we validate is not what the
// shell ultimately reads/writes:
//   - BashTool/pathValidation.ts: a `cd` that moves the effective cwd before a
//     write, flags (`mv --target-directory=…`) that hide the target, process
//     substitution, a `$VAR`/`%VAR%` REDIRECT target, or a catastrophic resolved
//     path (`rm -rf /`).
//   - the shared validatePath() here (BashTool's path validator): a UNC network
//     path, a `~user`/`~+`/`~-` tilde variant the shell expands elsewhere, a
//     `$VAR`/`%VAR%`/`=expansion` OPERAND, or a glob in a write/create operation.
//   - PowerShellTool/pathValidation.ts (its OWN parallel validator): the same UNC /
//     `$VAR`/`%VAR%` / write-glob / read-glob asks, plus PowerShell-specific ones —
//     backtick escapes, module-qualified provider paths (`::`), non-filesystem
//     PSDrive/provider paths (`env:`, `HKLM:`), and the compound `Set-Location` guard.
//
// Their messages promise the command "requires manual approval" / "cannot be
// auto-allowed by permission rules". But emitting `decisionReason.type: 'other'`
// routes them to resolvePermissionPrecedence's plain `continue` slot — so a
// tool-wide `allow: ["Bash"]` rule, bypassPermissions mode, or a PreToolUse hook
// could silently downgrade them to ALLOW. That is the exact bypass they exist to
// prevent: a DIRECT write to a sensitive path is already immune (it trips the
// sensitive-file safety check, type 'safetyCheck'), yet the same access reached via
// a `cd`, a `$VAR`, a `~user`, or a UNC path slipped through.
//
// Emitting `type: 'safetyCheck'` instead routes the ask to the bypass-immune
// `safety-check-ask` slot (resolvePermissionPrecedence step 1g), and — for a bash
// compound flattened to `subcommandResults` — is recognised by
// compoundAskIsBypassImmune. The message-builder (permissions.ts) handles
// 'safetyCheck' identically to 'other', so the user-facing prompt is unchanged.
//
// `classifierApprovable` (consumed by permissions.ts in auto/headless mode) decides
// whether the auto-mode AI classifier may still evaluate the ask:
//
//   - pathSafetyAskReason → classifierApprovable: TRUE. For a guard whose target the
//     classifier can read straight from the command text and reason about — a
//     `cd`/flagged write. This mirrors the DIRECT sensitive-file guard
//     (filesystem.ts, classifierApprovable: true) so the indirect (cd/flag) form is
//     never STRICTER than writing the same file directly, and a benign
//     `cd src && echo x > foo.ts` is not hard-denied in headless/auto.
//
//   - unresolvablePathSafetyAskReason → classifierApprovable: FALSE. For a target the
//     classifier cannot resolve either — process substitution runs an arbitrary
//     command, a `$VAR`/UNC/`~user` target is dynamic or host-dependent, a glob
//     expands unpredictably — or a catastrophic resolved path. Like a
//     suspicious-Windows-path bypass (filesystem.ts, classifierApprovable: false) it
//     must not be auto-approved by ANY path, the classifier included.
//
// Pure value-in/value-out so the shape — and its routing through
// resolvePermissionPrecedence — is node-testable.

/**
 * @param {string} reason
 * @param {boolean} classifierApprovable
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
function safetyCheckReason(reason, classifierApprovable) {
  return { type: 'safetyCheck', reason, classifierApprovable }
}

/**
 * Bypass-immune ask whose target the auto-mode classifier MAY still evaluate
 * (a `cd`/flagged write — mirrors the direct sensitive-file guard).
 * @param {string} reason
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
export function pathSafetyAskReason(reason) {
  return safetyCheckReason(reason, true)
}

/**
 * Bypass-immune ask that is classifier-IMMUNE too — a genuinely unresolvable target
 * (process substitution, a `$VAR`/UNC/`~user` path, a write-glob) or a catastrophic
 * resolved path.
 * @param {string} reason
 * @returns {{ type: 'safetyCheck', reason: string, classifierApprovable: boolean }}
 */
export function unresolvablePathSafetyAskReason(reason) {
  return safetyCheckReason(reason, false)
}
