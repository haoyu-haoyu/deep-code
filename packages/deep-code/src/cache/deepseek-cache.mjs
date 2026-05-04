import { createHash } from 'node:crypto'

export function createDeepSeekCacheUserId(workspacePath) {
  const hash = createHash('sha256')
    .update(String(workspacePath || process.cwd()))
    .digest('base64url')
    .slice(0, 32)
  return `dc_${hash}`
}

export function calculateDeepSeekCacheHitRate(usage = {}) {
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  const total = hit + miss
  return total === 0 ? 0 : hit / total
}

export function createDeepSeekCacheDiagnostics(usage = {}) {
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  return {
    promptCacheHitTokens: hit,
    promptCacheMissTokens: miss,
    promptCacheTotalTokens: hit + miss,
    promptCacheHitRate: calculateDeepSeekCacheHitRate(usage),
  }
}

export function createStableHash(value) {
  return createHash('sha256')
    .update(stableJsonStringify(value))
    .digest('base64url')
}

export function createDeepSeekPrefixHash({
  systemPrompt = [],
  tools = [],
  skills = [],
  repoSummary = '',
  stableHistory = [],
} = {}) {
  return createStableHash({
    repoSummary,
    skills,
    stableHistory,
    systemPrompt,
    tools,
  })
}

export function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value))
}

export function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJsonValue(value[key])
  }
  return out
}
