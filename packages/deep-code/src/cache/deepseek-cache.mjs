import { createHash } from 'node:crypto'

import { cacheHitRatio } from './hitRate.mjs'

// DeepSeek is the native default provider and supports cache_breakpoint, so
// recordTurn fires on EVERY model turn. Each record holds only SHA-256 hashes
// and token counts (no raw prompt/message content), but the array was never
// trimmed — a long agentic session accumulated thousands of dead records that
// nothing reads (every consumer reads at most the last 10 via getRecentTurns).
// Cap the window; the lifetime turn count is tracked separately so
// getSessionTotals().turnCount stays a true count rather than a capped length.
export const MAX_LIVE_TURNS = 50
const liveTurns = []
let recordedTurnCount = 0
let totalHit = 0
let totalMiss = 0

export function createDeepSeekCacheUserId(workspacePath) {
  const hash = createHash('sha256')
    .update(String(workspacePath || process.cwd()))
    .digest('base64url')
    .slice(0, 32)
  return `dc_${hash}`
}

export function calculateDeepSeekCacheHitRate(usage = {}) {
  return cacheHitRatio(
    usage.prompt_cache_hit_tokens ?? 0,
    usage.prompt_cache_miss_tokens ?? 0,
  )
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

export function recordTurn({
  turnId,
  hit = 0,
  miss = 0,
  prefixHash = '',
  componentHashes = {},
  timestamp = Date.now(),
} = {}) {
  const hitTokens = normalizeTokenCount(hit)
  const missTokens = normalizeTokenCount(miss)
  recordedTurnCount += 1
  const record = {
    // Default id from the lifetime count, not liveTurns.length, so it stays
    // monotonic past the cap (liveTurns.length would plateau and repeat).
    turnId: String(turnId || `turn-${recordedTurnCount}`),
    hitTokens,
    missTokens,
    hitRate: cacheHitRatio(hitTokens, missTokens),
    prefixHash: String(prefixHash || ''),
    componentHashes: cloneComponentHashes(componentHashes),
    timestamp,
  }

  liveTurns.push(record)
  if (liveTurns.length > MAX_LIVE_TURNS) liveTurns.shift()
  totalHit += hitTokens
  totalMiss += missTokens

  return cloneTurn(record)
}

export function getSessionTotals() {
  return {
    totalHit,
    totalMiss,
    hitRate: cacheHitRatio(totalHit, totalMiss),
    turnCount: recordedTurnCount,
  }
}

export function getRecentTurns(n = 10) {
  const count = Math.max(0, Math.trunc(Number(n) || 0))
  if (count === 0) return []
  return liveTurns.slice(-count).map(cloneTurn)
}

export function clear() {
  liveTurns.length = 0
  recordedTurnCount = 0
  totalHit = 0
  totalMiss = 0
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

// Key-stable JSON for content embedded in the cached request prefix — e.g. a
// structured-output schema hint appended to the system prompt — with the same
// cyclic/unstringifiable fallback (String(value)) a plain safe stringify has.
// Every other prefix component (tool/skill manifests) already canonicalizes via
// stableJsonStringify; this lets schema-hint callers do the same so a schema
// passed with differently-ordered keys does not bust the prefix cache.
export function stableJsonStringifySafe(value) {
  try {
    return stableJsonStringify(value)
  } catch {
    return String(value)
  }
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

function normalizeTokenCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.trunc(number)
}

function cloneTurn(record) {
  return {
    ...record,
    componentHashes: cloneComponentHashes(record.componentHashes),
  }
}

function cloneComponentHashes(componentHashes) {
  if (!componentHashes || typeof componentHashes !== 'object') return {}
  return Object.fromEntries(
    Object.entries(componentHashes).map(([key, value]) => [
      key,
      String(value),
    ]),
  )
}
