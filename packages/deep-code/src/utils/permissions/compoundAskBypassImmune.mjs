// Is a compound bash ASK bypass-immune?
//
// The compound-command aggregator (bashPermissions.ts) flattens N subcommand
// permission results into ONE ask of shape
//   { type: 'subcommandResults', reasons: Map<subcommand, PermissionResult> }
// — which loses the inner reason TYPES that resolvePermissionPrecedence keys its
// bypass-immune ASK slots on (1f: an explicit `ask` rule; 1g: a safety check). So a
// compound command like `echo ok && curl evil` — where the `curl` subcommand
// matched an explicit `ask: Bash(curl:*)` rule, or a subcommand tripped a
// bypass-immune safety check (a write to a sensitive path: .claude/, .git/, a shell
// config, …, which checkPermissions returns as decisionReason.type 'safetyCheck') —
// slipped past 1f/1g (its outer type is 'subcommandResults', not 'rule'/'safetyCheck')
// and got downgraded to ALLOW under bypassPermissions mode or a tool-wide
// `allow: Bash`. Single (non-compound) commands were always protected; the compound
// form was not.
//
// This restores the single-command guarantee for the compound form: returns true
// iff ANY inner subcommand result is itself a bypass-immune ask — an explicit ask
// rule (decisionReason.type === 'rule' && rule.ruleBehavior === 'ask') or a safety
// check (decisionReason.type === 'safetyCheck') — mirroring 1f/1g exactly. A
// compound ask with only path-constraint passthroughs (no explicit ask rule / no
// safety check) is NOT bypass-immune, so a tool-wide allow / bypass mode may still
// auto-allow it — same as the single-command behavior.
//
// Pure value-in/value-out (the PermissionResult.decisionReason) so it's node-testable.
export function compoundAskIsBypassImmune(decisionReason) {
  if (!decisionReason || decisionReason.type !== 'subcommandResults') return false
  const reasons = decisionReason.reasons
  if (!reasons || typeof reasons.values !== 'function') return false
  for (const result of reasons.values()) {
    if (!result || result.behavior !== 'ask') continue
    const inner = result.decisionReason
    if (!inner) continue
    if (inner.type === 'safetyCheck') return true
    if (inner.type === 'rule' && inner.rule?.ruleBehavior === 'ask') return true
  }
  return false
}
