// Which stop_reason values mean "the API completed the turn normally"?
//
// isResultSuccessful (queryHelpers.ts) treats a CONTENT-FREE terminal turn (the
// model chose to say nothing — e.g. a task-notification drain turn) as a success
// rather than an error_during_execution, but ONLY when the turn completed
// normally. That gate keyed on the Anthropic marker 'end_turn'.
//
// On the DeepSeek / OpenAI-compatible runtime nothing emits 'end_turn':
// mapStopReasonForClaudeCode (query/deepseek-call-model.mjs) maps a normal
// 'stop' finishReason straight through to stop_reason 'stop' (it only
// canonicalizes 'tool_calls'->'tool_use' and 'length'->'max_tokens'). So the
// carve-out was dead on this fork — a legitimate no-content turn surfaced as a
// spurious error (with the whole turn's logError buffer dumped) in print/SDK mode.
//
// 'stop' (DeepSeek/OpenAI) and 'end_turn' (Anthropic) are the two "completed
// normally" markers. 'tool_use'/'max_tokens' are NOT normal completions (a
// pending tool call / a truncation), and a null/'content_filter' stop_reason is
// not a clean normal completion either — so they are intentionally excluded.
//
// Pure string predicate so it's the single source of truth for the runtimes'
// normal-completion markers and is node-testable.

/**
 * @param {string | null | undefined} stopReason
 * @returns {boolean}
 */
export function isNormalCompletionStopReason(stopReason) {
  return stopReason === 'end_turn' || stopReason === 'stop'
}
