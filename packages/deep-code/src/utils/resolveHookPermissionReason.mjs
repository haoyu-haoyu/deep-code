/**
 * The effective permission-decision reason for a PreToolUse hook's result.
 *
 * A hook may supply a top-level `reason` and/or a more-specific
 * `hookSpecificOutput.permissionDecisionReason`. The hook-specific reason wins
 * WHEN PRESENT, but it is optional (schema: z.string().optional()). When it is
 * absent it must NOT clobber the already-bound top-level reason.
 *
 * A prior version assigned `hookSpecificOutput.permissionDecisionReason`
 * unconditionally, so a deny hook that provided only a top-level `reason` (e.g.
 * {decision:"block", reason:"Blocked by security policy", hookSpecificOutput:{
 * hookEventName:"PreToolUse", permissionDecision:"deny"}}) had its reason
 * overwritten with `undefined` — the user then saw the generic
 * "Hook PreToolUse:X deny this tool" message instead of the author's reason.
 *
 * Falls back with `||` so an empty-string hook-specific reason also yields to the
 * top-level one — mirroring the sibling deny-message precedence in
 * processHookJSONOutput (`permissionDecisionReason || json.reason || ...`).
 *
 * @param {string|undefined} hookSpecificReason  hookSpecificOutput.permissionDecisionReason
 * @param {string|undefined} fallbackReason      the already-bound reason (from json.reason)
 * @returns {string|undefined}
 */
export function resolveHookPermissionReason(hookSpecificReason, fallbackReason) {
  return hookSpecificReason || fallbackReason
}
