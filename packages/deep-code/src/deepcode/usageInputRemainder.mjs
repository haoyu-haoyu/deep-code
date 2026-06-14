// The Anthropic-shaped `input_tokens` field means the UNCACHED prompt remainder
// — NOT the full prompt. Every consumer that reconstructs the context/total
// size sums it with the cache fields:
//
//     total = input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens
//
// (getTokenCountFromUsage, calculateContextPercentages/StatusLine, forkedAgent's
// cache-hit-rate, analyzeContext, tokensToUSDCost...). If `input_tokens` already
// includes the cached portion, that sum DOUBLE-COUNTS it. DeepSeek's
// `prompt_tokens` is the FULL prompt (== prompt_cache_hit_tokens +
// prompt_cache_miss_tokens), so mapping it straight to `input_tokens` while also
// emitting cache_read=hit / cache_creation=miss inflated the reported context
// ~2x at DeepSeek's ~93% hit rate — firing autocompact at ~half the real budget
// and showing ~2x percent-used.
//
// uncachedInputRemainder is the single shared rule both usage mappers use to
// derive the contract-correct remainder:
//
//   - inputTokens present  → already the Anthropic remainder (only Anthropic-
//     shaped providers report this field), trust it verbatim.
//   - else promptTokens present → the FULL prompt (DeepSeek/OpenAI); the
//     remainder is promptTokens − cacheRead − cacheCreation (== 0 for DeepSeek,
//     where the whole prompt is either a hit or a miss). Never negative.
//   - else only cache fields known → the whole prompt was cached → remainder 0.
//   - else nothing to infer → undefined (caller keeps its prior value).
//
// A non-cache turn (cacheRead/cacheCreation both 0/undefined) returns the full
// promptTokens unchanged, so non-cache providers are byte-identical.
export function uncachedInputRemainder({
  inputTokens,
  promptTokens,
  cacheRead,
  cacheCreation,
} = {}) {
  if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
    return inputTokens
  }
  const hit = Number.isFinite(cacheRead) ? cacheRead : 0
  const miss = Number.isFinite(cacheCreation) ? cacheCreation : 0
  if (typeof promptTokens === 'number' && Number.isFinite(promptTokens)) {
    return Math.max(0, promptTokens - hit - miss)
  }
  if (Number.isFinite(cacheRead) || Number.isFinite(cacheCreation)) {
    return 0
  }
  return undefined
}
