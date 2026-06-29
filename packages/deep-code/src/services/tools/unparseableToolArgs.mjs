// A streamed tool call whose `arguments` were not valid JSON — output-token
// truncation mid-arguments (stop_reason 'max_tokens' carrying a partial
// tool_use is NOT recovered; it flows through tool execution), or a non-strict
// OpenAI-compatible gateway emitting slightly-malformed JSON. The model's
// intended parameters are unrecoverable, and a tool MUST NOT run with fabricated
// arguments — so the assemblers tag the tool_use input with a self-identifying
// sentinel that the tool-execution gate rejects uniformly for EVERY tool,
// surfacing a clean InputValidationError the model can self-correct.
//
// Why a tagged sentinel and not the old bare `{ _raw }` object:
//   - A built-in tool's concrete object schema (e.g. z.object({ file_path })) already
//     rejects `{ _raw }`, so the model got a clean validation error and retried.
//   - But an MCP tool validates with z.object({}).passthrough() (the real server
//     schema lives in a separate model-facing field, not the execution validator),
//     which ACCEPTS any object — so `{ _raw }` passed validation and was forwarded
//     verbatim to the remote MCP server as a phantom `_raw` argument with every
//     intended parameter missing. The server then either rejected opaquely or ran
//     a side-effecting action with all-default parameters.
//   - Detecting the sentinel by SHAPE (an object whose only key is `_raw`) is unsafe:
//     a model can legitimately send valid JSON `{"_raw":"..."}`, which parses fine
//     and never goes through the failure branch — rejecting it by shape would be a
//     false positive. A dedicated marker key, set ONLY on the parse-failure path,
//     makes the sentinel unambiguous: validly-parsed arguments never carry it.
//
// The marker is a plain string-keyed boolean (not a Symbol) so it survives a
// JSON round-trip of the assistant message, and `_raw` is retained for human/debug
// inspection of the unparseable text. The key is namespaced to make a collision
// with real model arguments effectively impossible; even on a collision the only
// consequence is a harmless "send valid JSON" retry prompt.

export const UNPARSEABLE_TOOL_ARGS_KEY = '__deepcodeUnparsedToolArguments'

export const UNPARSEABLE_TOOL_ARGS_MESSAGE =
  'The tool-call arguments were not valid JSON, so the tool was not run. ' +
  'Re-send the tool call with complete, valid JSON arguments.'

// Build the sentinel for a tool call whose raw `arguments` string failed to parse.
export function markUnparseableToolArgs(rawArguments) {
  return { _raw: rawArguments, [UNPARSEABLE_TOOL_ARGS_KEY]: true }
}

// True iff `value` is the unparseable-arguments sentinel (regardless of any other
// keys a later backfill step may have merged in — only the marker is load-bearing).
export function isUnparseableToolArgs(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value[UNPARSEABLE_TOOL_ARGS_KEY] === true
  )
}
