// Aggregate the permission decisions of several PreToolUse hooks that ran in
// PARALLEL, binding the reason + updatedInput to the hook that actually owns the
// surviving decision.
//
// The bug this fixes: executeHooks aggregated `permissionBehavior` with
// deny > ask > allow precedence, but for EVERY per-hook result it yielded the
// AGGREGATED behavior paired with THAT hook's reason/updatedInput. Since the
// hooks complete in nondeterministic arrival order and the consumer is
// last-writer-wins, an allow-hook's `updatedInput` could ride out under an
// aggregated `deny`/`ask`, and a deny-hook's specific reason could be erased by
// a later allow-hook (which carries no reason). Decoupling the winning decision
// from its payload makes the result order-independent: the reason/updatedInput
// always come from the hook whose behavior is the surviving aggregate.
//
// Precedence rank: deny > ask > allow > (passthrough/none). A hook updates the
// state ONLY when it STRICTLY raises the rank, and then it owns the payload; a
// same-or-lower-rank hook leaves the winning hook's reason/input intact. (Ties —
// e.g. two deny hooks — keep the first-seen reason; both are valid denials.)
const RANK = { deny: 3, ask: 2, allow: 1 }

export function emptyPermissionState() {
  return {
    behavior: undefined,
    reason: undefined,
    updatedInput: undefined,
    hookSource: undefined,
  }
}

/**
 * Fold one hook's permission decision into the aggregate.
 *
 * @param {{behavior?: string, reason?: string, updatedInput?: object, hookSource?: unknown}} state
 * @param {{behavior?: string, reason?: string, updatedInput?: object, hookSource?: unknown}} decision
 * @returns {typeof state} the same object if unchanged (so callers can detect a
 *   change by identity), or a new state owned by this hook.
 */
export function reducePermission(state, decision) {
  const behavior = decision.behavior
  const rank = RANK[behavior]
  if (!rank) return state // passthrough / undefined → no permission decision
  const currentRank = RANK[state.behavior] ?? 0
  if (rank <= currentRank) return state // doesn't beat the surviving decision
  return {
    behavior,
    reason: decision.reason,
    // Only allow/ask decisions carry a rewritten tool input; a deny never does.
    updatedInput:
      behavior === 'allow' || behavior === 'ask'
        ? decision.updatedInput
        : undefined,
    hookSource: decision.hookSource,
  }
}
