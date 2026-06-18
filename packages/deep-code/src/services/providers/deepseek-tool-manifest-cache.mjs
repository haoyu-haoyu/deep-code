import {
  toolToDeepSeekFunctionSchema,
  toolRawParameters,
  normalizeStrictMode,
} from '../../tools/deepseek-schema.mjs'

// Session-scoped cache of rendered DeepSeek tool function-schemas.
//
// The tool manifest renders into the request body's `tools`, which sits early on
// the DeepSeek cached prefix -- so any byte-level change busts the whole tool
// block AND everything downstream. buildDeepSeekRequest re-rendered it on EVERY
// agent-loop turn: `[...tools].sort(byteCompare)` then `Promise.all` of
// toolToDeepSeekFunctionSchema -- each awaiting async `tool.prompt()` (which can
// hit feature-gate reads) and deep-cloning/sanitizing the parameter schema.
//
// Memoizing per (tool identity, strict) locks the rendered bytes at first render:
// a hot-path win AND cache-moat hardening (a mid-session feature-gate flip or
// prompt drift can no longer churn the manifest bytes). This mirrors the Anthropic
// path's utils/toolSchemaCache.ts -- session-scoped, lock-at-first-render -- so the
// two providers behave the same.

const CACHE = new Map()

/** Drop all cached schemas (mirrors clearToolSchemaCache; for tests / session reset). */
export function clearDeepSeekToolManifestCache() {
  CACHE.clear()
}

/**
 * Cache key for a tool's rendered schema. The NAME alone is insufficient --
 * StructuredOutput / SyntheticOutput tools share one name but carry a per-call
 * schema (name-only keying served a stale schema -- PR#25424, 5.4% to 51% error
 * rate), and MCP tools likewise. The key folds in the tool's FULL parameter-schema
 * source via the shared toolRawParameters() (NOT just inputJSONSchema) so it reads
 * exactly what the renderer reads and can never serve a schema rendered from a
 * different field. The strict signal is folded in via normalizeStrictMode (the SAME
 * SSOT the renderer uses) because off / strict (safe|all) / nullable render DIFFERENT
 * parameters — keying on the raw boolean would let an 'all' render be served for a
 * 'nullable' request (the PR#25424 stale-schema class). Encoded as a JSON array so a
 * name/JSON containing a separator can't forge a collision.
 * @param {unknown} tool
 * @param {boolean | string} strict
 * @returns {string}
 */
export function deepSeekToolManifestCacheKey(tool, strict) {
  const name = tool?.name ?? tool?.function?.name ?? ''
  return JSON.stringify([
    name,
    toolRawParameters(tool) ?? null,
    normalizeStrictMode(strict),
  ])
}

/**
 * Memoized toolToDeepSeekFunctionSchema. On a hit, returns the SAME schema object
 * (so the serialized manifest bytes are identical turn-over-turn). On a miss,
 * renders once with the given options and caches it. The render options beyond
 * `strict` (tools/agents/getToolPermissionContext, which feed tool.prompt()) are
 * intentionally NOT part of the key -- like the Anthropic cache, the description is
 * locked at first render for prefix-byte stability.
 * @param {object} tool
 * @param {{ strict?: boolean | string }} [options]
 */
export async function cachedToolToDeepSeekFunctionSchema(tool, options = {}) {
  const key = deepSeekToolManifestCacheKey(tool, options.strict)
  const cached = CACHE.get(key)
  if (cached !== undefined) return cached
  const schema = await toolToDeepSeekFunctionSchema(tool, options)
  CACHE.set(key, schema)
  return schema
}
