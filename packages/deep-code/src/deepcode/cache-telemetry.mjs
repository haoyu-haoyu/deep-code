import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function resolveDeepSeekCacheStatsPath({
  env = process.env,
  config = {},
  homeDir = homedir(),
} = {}) {
  if (
    env.DEEPCODE_CACHE_STATS === 'disabled' ||
    env.DEEPSEEK_CACHE_STATS === 'disabled' ||
    env.DEEPCODE_CACHE_STATS_PATH === 'disabled'
  ) {
    return null
  }
  if (env.DEEPCODE_CACHE_STATS_PATH) return env.DEEPCODE_CACHE_STATS_PATH

  const cacheUserId = sanitizeCacheStatsName(config.cacheUserId ?? 'default')
  return join(homeDir, '.deepcode', 'cache-stats', `${cacheUserId}.json`)
}

export function createDeepSeekCacheStats(previous, usage = {}, {
  now = () => new Date().toISOString(),
} = {}) {
  const prior = previous ?? {}
  const lastHit = usage.prompt_cache_hit_tokens ?? 0
  const lastMiss = usage.prompt_cache_miss_tokens ?? 0
  const totalHit = (prior.totalPromptCacheHitTokens ?? 0) + lastHit
  const totalMiss = (prior.totalPromptCacheMissTokens ?? 0) + lastMiss
  const requestCount = (prior.requestCount ?? 0) + 1

  return {
    version: 1,
    requestCount,
    totalPromptCacheHitTokens: totalHit,
    totalPromptCacheMissTokens: totalMiss,
    totalPromptCacheHitRate: cacheHitRate(totalHit, totalMiss),
    lastPromptCacheHitTokens: lastHit,
    lastPromptCacheMissTokens: lastMiss,
    lastPromptCacheHitRate: cacheHitRate(lastHit, lastMiss),
    updatedAt: now(),
  }
}

export async function loadDeepSeekCacheStats(path) {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export async function recordDeepSeekCacheUsage({
  path,
  usage,
  now,
} = {}) {
  if (!path || !usage) return null
  try {
    const previous = await loadDeepSeekCacheStats(path)
    const stats = createDeepSeekCacheStats(previous, usage, { now })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(stats, null, 2)}\n`)
    return stats
  } catch {
    return null
  }
}

export function formatDeepSeekCacheStatus(stats) {
  if (!stats) return 'Cache telemetry: unavailable'

  return [
    `Cache telemetry: last_hit=${stats.lastPromptCacheHitTokens ?? 0} last_miss=${stats.lastPromptCacheMissTokens ?? 0} last_hit_rate=${formatRate(stats.lastPromptCacheHitRate)}`,
    `Cache telemetry: total_hit=${stats.totalPromptCacheHitTokens ?? 0} total_miss=${stats.totalPromptCacheMissTokens ?? 0} total_hit_rate=${formatRate(stats.totalPromptCacheHitRate)} requests=${stats.requestCount ?? 0}`,
    `Cache telemetry updated: ${stats.updatedAt ?? 'unknown'}`,
  ].join('\n')
}

function cacheHitRate(hit, miss) {
  const total = hit + miss
  return total === 0 ? 0 : Number((hit / total).toFixed(4))
}

function formatRate(rate) {
  return `${(Number(rate ?? 0) * 100).toFixed(1)}%`
}

function sanitizeCacheStatsName(name) {
  return String(name).replace(/[^A-Za-z0-9_.-]/g, '_')
}
