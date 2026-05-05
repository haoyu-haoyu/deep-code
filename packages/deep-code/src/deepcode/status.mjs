import {
  formatDeepSeekCacheStatus,
  loadDeepSeekCacheStats,
  resolveDeepSeekCacheStatsPath,
} from './cache-telemetry.mjs'
import {
  createDeepCodeStablePrefix,
  formatDeepCodePrefixStatus,
} from './stable-prefix.mjs'
import {
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from './harness-config.mjs'
import { resolveDeepSeekConfig } from '../services/providers/deepseek.mjs'

export async function buildDeepCodeStatusReport({
  env = process.env,
  cwd = process.cwd(),
  repoSummary = '',
  stablePrefix,
  cacheStats,
  cacheStatsPath,
} = {}) {
  const config = resolveDeepSeekConfig({ env, cwd })
  const harnessConfig = resolveDeepCodeHarnessConfig(env)
  const resolvedStablePrefix =
    stablePrefix ?? await createDeepCodeStablePrefix({ repoSummary })
  const resolvedCacheStatsPath =
    cacheStatsPath ?? resolveDeepSeekCacheStatsPath({ env, config })
  const resolvedCacheStats =
    cacheStats ?? await loadDeepSeekCacheStats(resolvedCacheStatsPath)

  return {
    provider: 'DeepSeek native',
    config,
    harnessConfig,
    cacheStats: resolvedCacheStats,
    cacheStatsPath: resolvedCacheStatsPath,
    stablePrefix: resolvedStablePrefix,
    apiKeyConfigured: Boolean(config.apiKey),
  }
}

export function formatDeepCodeStatus(report) {
  return [
    `Provider: ${report.provider}`,
    `Base URL: ${report.config.baseUrl}`,
    `Model: ${report.config.model}`,
    `Small model: ${report.config.smallModel}`,
    `Thinking: ${report.config.thinking}`,
    `Reasoning effort: ${report.config.reasoningEffort}`,
    formatDeepCodeHarnessStatus(report.harnessConfig),
    `Cache user_id: ${report.config.cacheUserId}`,
    formatDeepCodePrefixStatus(report.stablePrefix),
    `API key: ${report.apiKeyConfigured ? 'configured' : 'missing'}`,
    formatDeepSeekCacheStatus(report.cacheStats, {
      stablePrefix: report.stablePrefix,
    }),
  ].join('\n')
}

export function deepCodeStatusReportToProperties(report) {
  const stats = report.cacheStats
  return [
    { label: 'Provider', value: report.provider },
    { label: 'Base URL', value: report.config.baseUrl },
    { label: 'Model', value: report.config.model },
    { label: 'Small model', value: report.config.smallModel },
    { label: 'Thinking', value: report.config.thinking },
    { label: 'Reasoning effort', value: report.config.reasoningEffort },
    { label: 'Harness mode', value: report.harnessConfig.mode },
    {
      label: 'Harness max agents',
      value: String(report.harnessConfig.maxAgents),
    },
    { label: 'Prompt pack', value: report.harnessConfig.promptPack },
    { label: 'Strict tools', value: report.harnessConfig.strictTools },
    { label: 'Cache user_id', value: report.config.cacheUserId },
    {
      label: 'Stable prefix hash',
      value: report.stablePrefix?.prefixHash ?? 'unknown',
    },
    {
      label: 'Cache prefix',
      value: formatCachePrefix(report),
    },
    {
      label: 'Cache last hit/miss',
      value: stats
        ? `${stats.lastPromptCacheHitTokens ?? 0}/${stats.lastPromptCacheMissTokens ?? 0}`
        : 'unavailable',
    },
    {
      label: 'Cache hit rate',
      value: stats ? formatRate(stats.lastPromptCacheHitRate) : 'unavailable',
    },
    {
      label: 'Cache total hit/miss',
      value: stats
        ? `${stats.totalPromptCacheHitTokens ?? 0}/${stats.totalPromptCacheMissTokens ?? 0}`
        : 'unavailable',
    },
    {
      label: 'Cache total hit rate',
      value: stats ? formatRate(stats.totalPromptCacheHitRate) : 'unavailable',
    },
    {
      label: 'Cache telemetry updated',
      value: stats?.updatedAt ?? 'unavailable',
    },
    {
      label: 'API key',
      value: report.apiKeyConfigured ? 'configured' : 'missing',
    },
  ]
}

function formatCachePrefix(report) {
  const firstLine = formatDeepSeekCacheStatus(report.cacheStats, {
    stablePrefix: report.stablePrefix,
  }).split('\n')[0]
  return firstLine?.startsWith('Cache prefix: ')
    ? firstLine.slice('Cache prefix: '.length)
    : firstLine
}

function formatRate(rate) {
  return `${(Number(rate ?? 0) * 100).toFixed(1)}%`
}
