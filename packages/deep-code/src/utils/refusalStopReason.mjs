// Which stop_reason values mean "the model REFUSED" — a deliberate, clean turn
// end that is NOT an execution error?
//
// isResultSuccessful (queryHelpers.ts) treats a CONTENT-FREE terminal turn (the
// model emitted no content blocks) as a success rather than an
// error_during_execution, but only when the turn ended in a recognized clean
// way. A NORMAL completion ('stop' / 'end_turn', see isNormalCompletionStopReason)
// is one such way; a REFUSAL is the other.
//
// DeepSeek signals a safety refusal with finish reason 'content_filter', which
// mapStopReasonForClaudeCode (query/deepseek-call-model.mjs) passes through as
// stop_reason 'content_filter'; Anthropic's canonical refusal marker is
// 'refusal' (also what the ACP adapter emits — cli/serve/acp/protocol.mjs maps
// content_filter -> 'refusal'). A CONTENT-FREE refusal (the model declined and
// said nothing) was wrongly surfaced as error_during_execution — with is_error
// true and the turn's whole logError buffer dumped — because the normal-completion
// gate DELIBERATELY excludes 'content_filter' (it is not a NORMAL completion).
// But a refusal is still a legitimate terminal, not an internal error, so it is
// recognized here as its own non-error category.
//
// NOT included on purpose:
//  - 'insufficient_system_resource' — a server CAPACITY failure mid-generation;
//    surfacing it as an error (not a clean turn end) is correct, so it is left to
//    the error path.
//  - null / 'unknown' — an absent or lost finish reason is not a deliberate
//    refusal; it stays excluded.
//
// Pure string predicate so it is the single source of truth for the refusal
// markers and is node-testable, mirroring isNormalCompletionStopReason.

/**
 * @param {string | null | undefined} stopReason
 * @returns {boolean}
 */
export function isRefusalStopReason(stopReason) {
  return stopReason === 'content_filter' || stopReason === 'refusal'
}
