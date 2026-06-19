// A PreToolUse hook that BLOCKS via exit code 2 must ALSO emit a 'deny'
// permissionBehavior — not just a blockingError — so the deny is folded through the
// order-independent reducePermission aggregator and survives a racing JSON 'allow'
// from a concurrently-matched hook.
//
// Background: matched hooks run in parallel; their results are consumed last-writer-
// wins downstream. A JSON-`decision:block`/`permissionDecision:deny` hook is safe
// because processHookJSONOutput sets BOTH blockingError AND permissionBehavior:'deny'
// (so reducePermission keeps deny regardless of arrival order). An exit-2 deny used
// to set ONLY blockingError, bypassing the aggregator — so if it finished first, a
// later 'allow' clobbered it and the tool ran (an order-dependent permission
// fail-open). Setting permissionBehavior here makes the exit-2 deny structurally
// identical to the JSON-block deny, closing the channel asymmetry at its source.
//
// permissionBehavior is read downstream ONLY for PreToolUse (runPreToolUseHooks);
// every other event ignores it, so this returns 'deny' ONLY for PreToolUse and
// undefined otherwise — keeping all non-PreToolUse yields byte-identical.

/**
 * @param {string} hookEvent
 * @returns {'deny' | undefined}
 */
export function hookBlockPermissionBehavior(hookEvent) {
  return hookEvent === 'PreToolUse' ? 'deny' : undefined
}
