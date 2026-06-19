// Map a Claude-style thinkingConfig ({ type: 'enabled' | 'disabled' | 'adaptive' })
// to the DeepSeek request `thinking` override.
//
// The DeepSeek call-model receives thinkingConfig as a SIBLING of `options`
// (query.ts, services/runtime/messageSend, QueryEngine, main.tsx and WebSearchTool
// all pass it that way), but queryDeepSeekModelWithStreaming historically
// destructured only { messages, systemPrompt, tools, signal, options } and dropped
// it on the floor. So a caller that explicitly requested reasoning OFF — every
// one-shot helper (the prompt/agent hooks, compact, awaySummary, generateAgent,
// queryRuntimeHaiku) passes thinkingConfig: { type: 'disabled' } — still shipped
// thinking:enabled + reasoning_effort, burning reasoning tokens and busting the
// cache prefix for those calls.
//
// Only an explicit 'disabled' turns reasoning off. That makes buildDeepSeekRequest
// set thinking:{type:'disabled'} and omit reasoning_effort (deepseek.mjs:260-261).
// Every other shape — 'enabled', 'adaptive', an unknown type, or a missing config —
// returns undefined so resolveDeepSeekConfig's env/file/'enabled' fallthrough drives
// the request EXACTLY as before (the common path stays byte-identical → cache moat).

/**
 * @param {{ type?: string } | undefined | null} thinkingConfig
 * @returns {'disabled' | undefined}
 */
export function resolveDeepSeekThinkingMode(thinkingConfig) {
  return thinkingConfig?.type === 'disabled' ? 'disabled' : undefined
}

// Auto-route precedence for the `thinking` request field. On the `model: 'auto'`
// path the auto-router classifies the turn and picks route.thinking ('enabled' /
// 'disabled') from the messages — but a caller that EXPLICITLY disabled reasoning
// (compact, the hooks, awaySummary... all pass thinkingConfig:{type:'disabled'})
// must win over that task-based guess, otherwise the auto-route wrapper silently
// re-enables reasoning the caller asked to turn off. An explicit disable already
// arrives as context.thinking==='disabled' (set by resolveDeepSeekThinkingMode at
// the call-model); honor it. Otherwise defer to the router exactly as before
// (gated on extended-thinking support → undefined when unsupported).
/**
 * @param {unknown} contextThinking  the `thinking` already on the stream context
 * @param {'enabled' | 'disabled' | undefined} routeThinking  the auto-router's choice
 * @param {boolean} supportsExtendedThinking
 * @returns {'enabled' | 'disabled' | undefined}
 */
export function resolveAutoRouteThinking(contextThinking, routeThinking, supportsExtendedThinking) {
  if (contextThinking === 'disabled') return 'disabled'
  return supportsExtendedThinking ? routeThinking : undefined
}
