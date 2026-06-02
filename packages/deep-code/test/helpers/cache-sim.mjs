// Pure, deterministic OFFLINE simulation of DeepSeek's prefix-cache token
// accounting — a CI guard, not a runtime feature (lives under test/, not src/,
// so it is never bundled).
//
// DeepSeek caches a prompt in block-aligned PREFIXES: a later request is served
// from cache for the longest block-aligned prefix it shares BYTE-FOR-BYTE with
// an earlier request; the remainder is a cache MISS. The live cache-e2e probe
// measures this in TOKENS against the real API (~93% hit). This module models
// the same mechanic at the serialized-CHARACTER level — a deterministic proxy
// (token counts are ~proportional within identical content). It is not meant to
// reproduce the exact live percentage; it exists to catch the regressions that
// matter WITHOUT an API call: a prefix that drifts (tool reorder, a timestamp
// leaking into the prefix, a mutated earlier message, a compaction that rewrites
// the head) collapses the simulated hit rate, turning a silent production
// billing/latency regression into a red test.

// ~a 64-token DeepSeek cache block at ~4 chars/token. The exact value only
// shifts how much of a trailing PARTIAL block is uncounted; regression detection
// (hit rate high vs. collapsed) is insensitive to it.
export const DEFAULT_BLOCK_CHARS = 256

/** Length of the longest common BYTE/char prefix of two strings. */
export function longestCommonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/**
 * Serialize a built request body to the ordered character stream the prefix
 * cache sees. The cached prefix is NOT just the messages: per the project's own
 * cache model (src/deepcode/stable-prefix.mjs) the prompt is assembled as system
 * instructions → TOOL MANIFEST → conversation history. We reconstruct that
 * assembly order (not the wire-field order) so a change to the toolset diverges
 * the prefix BEFORE the conversation and is caught.
 *
 * The serialized stream is, in order:
 *   0. a PARTITION tag — `{model, thinking, reasoning_effort}`. These select the
 *      cache partition (a different model = a different cache), so a change here
 *      diverges at position 0 = total miss. (Transport/sampling fields —
 *      stream, max_tokens, temperature, user_id, … — are deliberately omitted:
 *      they do not define the cached prompt CONTENT.)
 *   1. the system message, IF messages[0] is a `role:'system'` message (with no
 *      system prompt there is none, and the tool manifest precedes all history).
 *   2. the TOOL manifest (`body.tools`), if present.
 *   3. the conversation history.
 * Append-only turns only grow (3), so the prior request stays a byte-identical
 * prefix (the moat); a change to (0)/(1)/(2) diverges earlier and is caught.
 *
 * (Tool ORDER cannot drift — buildDeepSeekRequest sorts tools before serializing
 * — but tool content/schema, model, and thinking changes are real cache-busters
 * this captures.)
 */
export function serializeRequestForCache(requestBody) {
  const body = requestBody ?? {}
  const messages = Array.isArray(body.messages) ? body.messages : []
  const hasSystem = messages[0]?.role === 'system'
  const history = hasSystem ? messages.slice(1) : messages
  const parts = [
    JSON.stringify({
      model: body.model,
      thinking: body.thinking,
      reasoning_effort: body.reasoning_effort,
    }),
  ]
  if (hasSystem) parts.push(JSON.stringify(messages[0]))
  if (body.tools !== undefined) parts.push(JSON.stringify(body.tools))
  for (const m of history) parts.push(JSON.stringify(m))
  return parts.join('\n')
}

/**
 * Simulate per-turn cache hit/miss for an ORDERED list of serialized request
 * strings (one per turn). The cache holds every PRIOR request's prefix; the hit
 * for turn i is the longest block-aligned prefix it shares with any earlier turn
 * (= turn i-1 in an append-only loop). Turn 0 is an all-miss cold start.
 *
 * @returns {{hit:number, miss:number, total:number, hitRate:number}[]} per turn
 */
export function simulateDeepSeekPrefixCache(serializedRequests, { blockChars = DEFAULT_BLOCK_CHARS } = {}) {
  if (!Number.isInteger(blockChars) || blockChars < 1) {
    throw new RangeError(`blockChars must be a positive integer, got ${blockChars}`)
  }
  const seen = []
  const perTurn = []
  for (const cur of serializedRequests) {
    const text = String(cur ?? '')
    let lcp = 0
    for (const prior of seen) {
      const l = longestCommonPrefixLength(prior, text)
      if (l > lcp) lcp = l
    }
    const hit = Math.min(Math.floor(lcp / blockChars) * blockChars, text.length)
    const total = text.length
    perTurn.push({ hit, miss: total - hit, total, hitRate: total > 0 ? hit / total : 0 })
    seen.push(text)
  }
  return perTurn
}

/** Aggregate a per-turn simulation into a single hit-rate summary. */
export function summarizePrefixCacheSimulation(perTurn) {
  const hit = perTurn.reduce((s, t) => s + t.hit, 0)
  const total = perTurn.reduce((s, t) => s + t.total, 0)
  return {
    hit,
    miss: total - hit,
    total,
    hitRate: total > 0 ? hit / total : 0,
    turns: perTurn.length,
  }
}
