import { getSessionTotals } from '../cache/deepseek-cache.mjs'
import { providerSupports } from '../deepcode/provider-capabilities.mjs'
import { resolveProviderConfig } from '../services/providers/provider-config.mjs'
import { resolveModelProvider } from '../services/providers/registry.mjs'

const UNSUPPORTED_PROVIDER = Object.freeze({
  supports: () => false,
})

export function getCurrentCacheStatusText({
  env = process.env,
  totals = getSessionTotals(),
} = {}) {
  return formatCacheStatusText({
    provider: resolveCurrentCacheStatusProvider(env),
    totals,
  })
}

export function resolveCurrentCacheStatusProvider(env = process.env) {
  try {
    const config = resolveProviderConfig({
      env,
      fileConfig: { providers: {} },
    })
    return resolveModelProvider({
      env,
      name: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
    })
  } catch {
    return UNSUPPORTED_PROVIDER
  }
}

export function formatCacheStatusText({ provider, totals } = {}) {
  if (!providerSupports(provider, 'cache_breakpoint')) return null
  const hit = normalizeTokenCount(totals?.totalHit)
  const miss = normalizeTokenCount(totals?.totalMiss)
  const total = hit + miss
  if (total === 0) return null

  const hitRate = Number.isFinite(totals?.hitRate)
    ? Number(totals.hitRate)
    : hit / total
  const percentage = Math.round(Math.max(0, hitRate) * 100)
  return `cache: ${percentage}% hit (${formatCompactTokenCount(hit)} / ${formatCompactTokenCount(total)})`
}

export function formatCompactTokenCount(value) {
  const count = normalizeTokenCount(value)
  if (count >= 1_000_000) return `${formatSingleDecimal(count / 1_000_000)}M`
  if (count >= 1_000) return `${formatSingleDecimal(count / 1_000)}k`
  return String(count)
}

function normalizeTokenCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.trunc(number)
}

function formatSingleDecimal(value) {
  const formatted = value.toFixed(1)
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted
}
