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
//   • a MATCHED 'ask' rule        → prompt the host (ask), no record (the user sees it)
//   • everything else (an allow rule, or the no-match 'ask' default at effort
//     off/standard) → DEFER: the fortress has no blocking opinion, so the host's
//     normal permission flow decides. THIS is why the default state is inert/
//     behavior-identical (no rules + effort 'off' → no-match 'ask' → defer).
//   • DRY-RUN: dry-run must not CHANGE behavior, so neither a would-be deny NOR a
//     would-be (matched) ask actually fires — both 'defer' — but both are RECORDED
//     (with dryRun:true) so the model/UI sees what WOULD have been blocked OR prompted.
//     (Without recording the ask, dry-run would silently swallow it — strictly LESS
//     visible than normal mode, where the prompt is seen. Symmetric with the deny path.)
//   • `action` carries the matched decision ('deny'|'ask') so a recorder can label the
//     event correctly (a would-be ask must not be logged as a deny).

/**
 * Map a fortress decision result into a file-tool enforcement directive.
 * @param {{decision?: string, rule?: object|null, reason?: string}} decisionResult
 *   from manager.resolveFortressDecision({resource, target}).
 * @param {{dryRun?: boolean}} [options]
 * @returns {{enforce: ('deny'|'ask'|'defer'), record: boolean, dryRun: boolean,
 *           matched: boolean, action: ('deny'|'ask'|undefined), reason: (string|undefined)}}
 */
export function fortressDecisionDirective(decisionResult, options = {}) {
  const dryRun = options?.dryRun === true
  const decision = decisionResult != null && typeof decisionResult === 'object' ? decisionResult.decision : undefined
  const matched = decisionResult != null && typeof decisionResult === 'object' && decisionResult.rule != null
  const reason = decisionResult != null && typeof decisionResult === 'object' ? decisionResult.reason : undefined

  if (decision === 'deny') {
    // record only a MATCHED deny (an explicit rule breach); the paranoid no-match deny
    // still blocks but is not logged as a violation. Dry-run never blocks (log-only).
    return { enforce: dryRun ? 'defer' : 'deny', record: matched, dryRun, matched, action: 'deny', reason }
  }
  if (decision === 'ask' && matched) {
    // Normal mode: prompt (ask), no record — the user sees the prompt. Dry-run: must not
    // actually prompt (that IS a behavior change), so DEFER, but RECORD with dryRun:true so
    // the model/UI sees the confirmation that WOULD have been required (symmetric with deny).
    return { enforce: dryRun ? 'defer' : 'ask', record: dryRun, dryRun, matched: true, action: 'ask', reason }
  }
  // allow rule, or the no-match 'ask' default (effort off/standard) → defer to the host.
  return { enforce: 'defer', record: false, dryRun: false, matched: false, action: undefined, reason }
}

/**
 * The human-readable verb a recorder uses for a directive's `action`, so EVERY adapter
 * (file-tool, process-exec, bash-read) labels a recorded event consistently — and a
 * would-be ASK (recorded only in dry-run) is never mislogged as a deny.
 * @param {('deny'|'ask'|undefined)} action  the directive's matched action.
 * @param {boolean} dryRun
 * @returns {string}
 */
export function fortressRecordVerb(action, dryRun) {
  if (action === 'ask') return dryRun ? 'would require confirmation for' : 'requires confirmation for'
  return dryRun ? 'would deny' : 'denied'
}
