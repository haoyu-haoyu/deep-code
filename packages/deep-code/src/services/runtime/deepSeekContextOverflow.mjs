// Recognizing a DeepSeek/OpenAI-compatible server-side CONTEXT-OVERFLOW error.
//
// When the prompt exceeds the model's context window the DeepSeek server returns
// an HTTP 400 whose OpenAI-style body says, e.g.:
//   {"error":{"message":"This model's maximum context length is 65536 tokens.
//    However, your messages resulted in 70000 tokens. Please reduce the length
//    of the messages.","type":"invalid_request_error","code":"context_length_exceeded"}}
// createDeepSeekApiError surfaces this verbatim as `DeepSeek API 400: {body}`.
//
// The rest of the codebase (inherited from upstream Claude Code) recognizes a
// context overflow ONLY by the Anthropic literal PROMPT_TOO_LONG_ERROR_MESSAGE
// ('Prompt is too long'): isPromptTooLongMessage (runtime/errors.ts), the UI's
// "Context limit reached" case (AssistantTextMessage.tsx), and the compact
// PTL-retry (compact.ts). The DeepSeek text begins with 'DeepSeek API 400', which
// matches NONE of them — so a real overflow renders the raw provider-JSON blob to
// the user instead of the friendly message, and is never classified as PTL.
//
// This pure leaf detects the overflow from the error text and best-effort extracts
// the token counts, so the caller can re-surface it with the canonical literal.
// Markers are deliberately SPECIFIC to a context overflow (not all 400s) to avoid
// classifying an unrelated invalid-request 400 as PTL.

const OVERFLOW_MARKERS = [
  /context[_ ]length[_ ]exceeded/i,
  /maximum context length/i,
  /reduce the (?:length|number)[^.]{0,40}?\btokens?\b/i,
  /\btoo many tokens\b/i,
]

/**
 * @param {string | null | undefined} text  the error message / response body
 * @returns {{ isOverflow: boolean, actualTokens?: number, limitTokens?: number }}
 */
export function detectDeepSeekContextOverflow(text) {
  if (typeof text !== 'string' || text.length === 0) return { isOverflow: false }
  if (!OVERFLOW_MARKERS.some(re => re.test(text))) return { isOverflow: false }

  // limit = the model's maximum; actual = what the request used. Upstream PTL
  // formats these as "actual tokens > limit maximum".
  const limit = matchInt(text, /maximum context length is\s*(\d+)/i)
  const actual = matchInt(
    text,
    /(?:resulted in|you requested|requested)\s*(\d+)\s*tokens?/i,
  )

  return {
    isOverflow: true,
    ...(actual !== undefined ? { actualTokens: actual } : {}),
    ...(limit !== undefined ? { limitTokens: limit } : {}),
  }
}

/**
 * Build the canonical surfaced message. The literal is injected (it lives in the
 * .ts runtime/errors layer, which .mjs must not import) so it stays a single
 * source of truth. Includes the token counts in the upstream
 * "N tokens > M maximum" shape when both are known (so getPromptTooLongTokenGap
 * can parse them); otherwise just the bare literal.
 *
 * @param {{ actualTokens?: number, limitTokens?: number }} overflow
 * @param {string} promptTooLongLiteral  PROMPT_TOO_LONG_ERROR_MESSAGE
 * @returns {string}
 */
export function formatContextOverflowMessage(overflow, promptTooLongLiteral) {
  const { actualTokens, limitTokens } = overflow ?? {}
  if (actualTokens !== undefined && limitTokens !== undefined) {
    return `${promptTooLongLiteral}: ${actualTokens} tokens > ${limitTokens} maximum`
  }
  return promptTooLongLiteral
}

function matchInt(text, re) {
  const m = text.match(re)
  return m ? parseInt(m[1], 10) : undefined
}
