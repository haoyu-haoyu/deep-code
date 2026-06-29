// Detecting an output-token-cap truncation across the two runtime conventions.
//
// The query loop has a recovery path for a turn the model could not finish
// because it hit the output-token cap: escalate the cap once, then inject a
// "resume directly" message and continue, up to a small retry limit (query.ts
// ~1086-1160). Whether that path fires hinges entirely on DETECTING the
// truncation — and the two runtimes signal it differently:
//
//   - Upstream Claude Code surfaces a SYNTHETIC API-error message with
//     apiError === 'max_output_tokens' (no real content; an error bubble).
//   - The DeepSeek / OpenAI-compatible runtime returns a REAL assistant message:
//     deepSeekResponseToAssistantMessage maps a 'length' finishReason to
//     message.stop_reason 'max_tokens' and sets NO apiError. The partial text the
//     model produced is genuine content.
//
// The original predicate keyed ONLY on apiError === 'max_output_tokens', a value
// nothing in the DeepSeek runtime ever sets — so on this fork the ENTIRE recovery
// (escalate + multi-turn resume) was dead, and every output-cap truncation was
// silently committed as a finished turn with no auto-continue.
//
// Two distinct questions, two predicates:
//
//   isMaxOutputTokensWithheld — is this the WITHHELD error-bubble form? Only the
//     apiError form is withheld from SDK callers (it would otherwise terminate
//     SDK sessions that bail on any `error` field) and re-surfaced when recovery
//     exhausts. The DeepSeek form is real content: it streams and persists
//     normally and must NOT be withheld (that would drop it from the transcript)
//     nor re-yielded on exhaustion (that would duplicate it).
//
//   isMaxOutputTokensTruncation — should the RECOVERY act on this? True for both
//     forms. A truncation that carries a (partial) tool_use is excluded: it goes
//     through the tool-execution path (needsFollowUp), not text recovery.
//
// Pure over primitives so the query.ts type-guard wrappers stay thin and this is
// node-testable without constructing a full AssistantMessage.

/**
 * @param {{ apiError?: string | undefined }} m
 * @returns {boolean}
 */
export function isMaxOutputTokensWithheld({ apiError }) {
  return apiError === 'max_output_tokens'
}

/**
 * @param {{ apiError?: string | undefined, stopReason?: string | null | undefined, hasToolUse?: boolean }} m
 * @returns {boolean}
 */
export function isMaxOutputTokensTruncation({ apiError, stopReason, hasToolUse }) {
  if (isMaxOutputTokensWithheld({ apiError })) return true
  return stopReason === 'max_tokens' && !hasToolUse
}
