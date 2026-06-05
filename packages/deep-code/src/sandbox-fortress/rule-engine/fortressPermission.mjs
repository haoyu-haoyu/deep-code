// Pure, node-testable mapper: a fortress resolveDecision result → a per-call
// enforcement directive for the FILE TOOLS (Read/Edit/Write) — F3 wiring PR-F.
// Standalone — nothing imports it until the file-tool hook wires it in, so by itself
// dist is byte-identical.
//
// This is the FAITHFUL enforcement path: the file tools know the concrete ABSOLUTE
// target, so the fortress matcher (resolveResourceDecision) applies its real glob/path
// semantics with NO OS translation — which is why it can enforce things the Bash
// OS-pattern path (PR-D) deliberately deferred: fs-read denies (macOS allowRead would
// win over denyRead), and the non-projectable glob/relative fs-write patterns.
//
// DECISION → DIRECTIVE semantics (deny-first absolute + effort default):
//   • a MATCHED deny rule        → block (deny), and RECORD a violation
//   • a no-match 'deny' (paranoid/effort 'max' default) → block (deny), but do NOT
//     record — it is the effort posture, not a rule breach (avoids per-access spam)
//   • a MATCHED 'ask' rule        → prompt the host (ask)
//   • everything else (an allow rule, or the no-match 'ask' default at effort
//     off/standard) → DEFER: the fortress has no blocking opinion, so the host's
//     normal permission flow decides. THIS is why the default state is inert/
//     behavior-identical (no rules + effort 'off' → no-match 'ask' → defer).
//   • DRY-RUN: a would-be deny does NOT block (enforce 'defer') but is still recorded
//     (with dryRun:true) so the model/UI can see what WOULD have been blocked.

/**
 * Map a fortress decision result into a file-tool enforcement directive.
 * @param {{decision?: string, rule?: object|null, reason?: string}} decisionResult
 *   from manager.resolveFortressDecision({resource, target}).
 * @param {{dryRun?: boolean}} [options]
 * @returns {{enforce: ('deny'|'ask'|'defer'), record: boolean, dryRun: boolean,
 *           matched: boolean, reason: (string|undefined)}}
 */
export function fortressDecisionDirective(decisionResult, options = {}) {
  const dryRun = options?.dryRun === true
  const decision = decisionResult != null && typeof decisionResult === 'object' ? decisionResult.decision : undefined
  const matched = decisionResult != null && typeof decisionResult === 'object' && decisionResult.rule != null
  const reason = decisionResult != null && typeof decisionResult === 'object' ? decisionResult.reason : undefined

  if (decision === 'deny') {
    // record only a MATCHED deny (an explicit rule breach); the paranoid no-match deny
    // still blocks but is not logged as a violation. Dry-run never blocks (log-only).
    return { enforce: dryRun ? 'defer' : 'deny', record: matched, dryRun, matched, reason }
  }
  if (decision === 'ask' && matched) {
    return { enforce: 'ask', record: false, dryRun: false, matched: true, reason }
  }
  // allow rule, or the no-match 'ask' default (effort off/standard) → defer to the host.
  return { enforce: 'defer', record: false, dryRun: false, matched: false, reason }
}
