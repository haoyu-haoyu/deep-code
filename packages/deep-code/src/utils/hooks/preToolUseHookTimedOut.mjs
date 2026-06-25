/**
 * Whether an ABORTED hook is a PreToolUse permission gate that TIMED OUT (rather
 * than being cancelled by the outer signal) and must therefore FAIL CLOSED.
 *
 * A hook runs under a combined abort signal = (outer/user cancel signal) OR (the
 * per-hook execution timeout). `result.aborted` reflects the combined signal. When
 * the combined signal aborted but the OUTER signal did NOT, the per-hook TIMEOUT
 * fired — the hook never finished emitting its decision.
 *
 * A PreToolUse permission-gating hook that times out previously fell into the
 * generic "cancelled" branch, which yields neither a blockingError nor a
 * permissionBehavior — so the tool ran (a silent permission FAIL-OPEN). It must
 * instead DENY (fail closed), mirroring how a cap-exceeded hook fails closed: a
 * hook that was killed before it could decide cannot be assumed to allow.
 *
 * Scope is deliberately narrow:
 *  - Only a real TIMEOUT fails closed. A genuine OUTER cancellation (the user
 *    aborted the whole turn) stays a plain cancellation — the tool is going away
 *    regardless, and denying it would just emit a confusing "hook denied" message.
 *  - Only PreToolUse. Other events (Stop, UserPromptSubmit, SessionStart, …) keep
 *    their existing non-blocking cancellation on timeout; forcing a hung Stop hook
 *    to block could wedge the session, which is out of scope for this fix.
 *
 * @param {string} hookEvent
 * @param {boolean} combinedAborted  result.aborted (the combined abort signal)
 * @param {boolean} outerAborted     the outer/user cancel signal's aborted state
 * @returns {boolean} true => the PreToolUse hook timed out and must deny the tool
 */
export function preToolUseHookTimedOut(hookEvent, combinedAborted, outerAborted) {
  return hookEvent === 'PreToolUse' && !!combinedAborted && !outerAborted
}
