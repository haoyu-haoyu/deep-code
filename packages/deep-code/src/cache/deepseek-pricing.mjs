export const DEEPSEEK_PRICING_SNAPSHOT_DATE = '2026-05-27'

export const DEEPSEEK_INPUT_PRICING_USD_PER_MILLION = Object.freeze({
  'deepseek-v4-flash': Object.freeze({
    cacheHit: 0.0028,
    cacheMiss: 0.14,
  }),
  'deepseek-v4-pro': Object.freeze({
    cacheHit: 0.003625,
    cacheMiss: 0.435,
    promotionEndsAt: '2026-05-31T15:59:00Z',
  }),
})

export function estimateDeepSeekCacheSavingsUsd({
  hitTokens = 0,
  model = 'deepseek-v4-flash',
} = {}) {
  const pricing =
    DEEPSEEK_INPUT_PRICING_USD_PER_MILLION[model] ??
    DEEPSEEK_INPUT_PRICING_USD_PER_MILLION['deepseek-v4-flash']
  const savedPerMillion = Math.max(0, pricing.cacheMiss - pricing.cacheHit)
  return (Math.max(0, Number(hitTokens) || 0) * savedPerMillion) / 1_000_000
}

export function formatUsdEstimate(value) {
  return `$${Number(value || 0).toFixed(6)}`
}
