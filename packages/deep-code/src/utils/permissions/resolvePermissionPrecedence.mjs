// Precedence among the rule-based and tool-content permission signals.
//
// THE INVARIANT: any DENY — tool-wide (e.g. `deny: ["Bash"]`) OR content-specific
// (e.g. `deny: ["Bash(rm:*)"]`) — outranks a tool-wide ASK rule. Deny always wins;
// it can never be downgraded to an approvable prompt. This matches the user-facing
// guarantee ("denied tools are always rejected") and the deny > ask > allow order.
//
// The bug this fixes: a content-specific deny is only detectable by the tool's own
// checkPermissions() pass, which historically ran AFTER the tool-wide ask had already
// short-circuited — so `{ask:["Bash"], deny:["Bash(rm:*)"]}` silently downgraded
// `rm -rf ...` from a hard deny to an approvable ask. Hoisting the content-deny check
// above the tool-wide-ask check (content-deny at slot 2, tool-wide-ask at slot 3)
// closes that inversion while leaving every other relative ordering untouched.
//
// Pure & deterministic — the two callers (hasPermissionsToUseToolInner, the full
// pipeline; and checkRuleBasedPermissions, the bypass-respecting rule-only subset)
// compute the signals, call this, and map the returned slot to their own decision
// shape. Single source of truth, fully unit-testable.

/**
 * @typedef {(
 *   | 'tool-wide-deny'
 *   | 'content-deny'
 *   | 'tool-wide-ask'
 *   | 'requires-interaction'
 *   | 'content-ask-rule'
 *   | 'safety-check-ask'
 *   | 'continue'
 * )} PermissionPrecedenceSlot
 */

/**
 * Resolve which rule-based / content permission signal wins, in the order:
 * tool-wide deny → content deny → tool-wide ask → requires-interaction ask →
 * content ask-rule → bypass-immune safety-check ask → continue (no objection).
 *
 * @param {object} signals
 * @param {boolean} [signals.toolWideDenied]          a tool-wide deny rule matched
 *   (callers usually early-return this before the content check, to avoid running
 *   checkPermissions on a fully-denied tool — so it defaults to false here)
 * @param {boolean} signals.toolWideAsk               a tool-wide ask rule is in effect
 *   (already AND-ed with `!canSandboxAutoAllow` by the caller)
 * @param {'deny'|'ask'|'allow'|'passthrough'|undefined} signals.contentBehavior
 *   the behavior tool.checkPermissions() returned
 * @param {string} [signals.contentReasonType]        decisionReason.type ('rule'|'safetyCheck'|…)
 * @param {string} [signals.contentRuleBehavior]      decisionReason.rule.ruleBehavior ('ask'|…)
 * @param {boolean} [signals.requiresUserInteraction] tool.requiresUserInteraction() (full pipeline only)
 * @returns {PermissionPrecedenceSlot}
 */
export function resolvePermissionPrecedence({
  toolWideDenied = false,
  toolWideAsk,
  contentBehavior,
  contentReasonType,
  contentRuleBehavior,
  requiresUserInteraction = false,
}) {
  // 1a. Entire tool denied by rule.
  if (toolWideDenied) return 'tool-wide-deny'
  // 1d (HOISTED). A content-specific deny outranks the tool-wide ask below — deny
  // always wins. This single reordering is the whole fix.
  if (contentBehavior === 'deny') return 'content-deny'
  // 1b. Entire tool has an ask rule (and is not sandbox-auto-allowed).
  if (toolWideAsk) return 'tool-wide-ask'
  // 1e. Tool requires user interaction and the content check asks.
  if (requiresUserInteraction && contentBehavior === 'ask') return 'requires-interaction'
  // 1f. Content-specific ask rule (e.g. Bash(npm publish:*)).
  if (
    contentBehavior === 'ask' &&
    contentReasonType === 'rule' &&
    contentRuleBehavior === 'ask'
  ) {
    return 'content-ask-rule'
  }
  // 1g. Bypass-immune safety check (.git/, .claude/, shell configs, …).
  if (contentBehavior === 'ask' && contentReasonType === 'safetyCheck') {
    return 'safety-check-ask'
  }
  // No rule-based objection.
  return 'continue'
}
