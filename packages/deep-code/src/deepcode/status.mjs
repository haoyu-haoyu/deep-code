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
import {
  formatDeepCodeContextPolicy,
  resolveDeepCodeContextPolicy,
} from './context-policy.mjs'
import {
  formatDeepCodeHarnessAgentLifecycle,
  formatDeepCodeHarnessRuntimeDecision,
  getLastDeepCodeHarnessAgentLifecycle,
  getLastDeepCodeHarnessRuntimeDecision,
} from './harness-runtime.mjs'
import { resolveDeepSeekConfig } from '../services/providers/deepseek.mjs'
import { resolveProviderConfig } from '../services/providers/provider-config.mjs'
import { resolveModelProvider } from '../services/providers/registry.mjs'
import {
  createProviderCapabilitySnapshot,
  providerSupports,
} from './provider-capabilities.mjs'

export async function buildDeepCodeStatusReport({
  env = process.env,
  cwd = process.cwd(),
  repoSummary = '',
  stablePrefix,
  cacheStats,
  cacheStatsPath,
} = {}) {
  const config = resolveDeepSeekConfig({ env, cwd })
  const providerConfig = resolveProviderConfig({ env })
  const modelProvider = resolveModelProvider({
    env,
    name: providerConfig.provider,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    defaultModel: providerConfig.defaultModel,
    defaults: { env, cwd },
  })
  const harnessConfig = resolveDeepCodeHarnessConfig(env)
  const contextPolicy = resolveDeepCodeContextPolicy({
    env,
    model: config.model,
  })
  const resolvedStablePrefix =
    stablePrefix ?? await createDeepCodeStablePrefix({ repoSummary })
  const resolvedCacheStatsPath =
    cacheStatsPath ?? resolveDeepSeekCacheStatsPath({ env, config })
  const resolvedCacheStats =
    cacheStats ?? await loadDeepSeekCacheStats(resolvedCacheStatsPath)

  return {
    provider: modelProvider.name === 'deepseek' ? 'DeepSeek native' : modelProvider.name,
    providerCapabilities: createProviderCapabilitySnapshot(modelProvider),
    config,
    contextPolicy,
    harnessConfig,
    harnessRuntimeDecision: getLastDeepCodeHarnessRuntimeDecision(),
    harnessAgentLifecycle: getLastDeepCodeHarnessAgentLifecycle(),
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
    formatDeepCodeContextPolicy(report.contextPolicy),
    supportsReportCapability(report, 'extended_thinking')
      ? `Thinking: ${report.config.thinking}`
      : '',
    supportsReportCapability(report, 'reasoning_effort')
      ? `Reasoning effort: ${report.config.reasoningEffort}`
      : '',
    formatDeepCodeHarnessStatus(report.harnessConfig),
    report.harnessRuntimeDecision
      ? formatDeepCodeHarnessRuntimeDecision(report.harnessRuntimeDecision)
      : 'Harness runtime: unavailable',
    formatDeepCodeHarnessAgentLifecycle(report.harnessAgentLifecycle),
    supportsReportCapability(report, 'user_id')
      ? `Cache user_id: ${report.config.cacheUserId}`
      : '',
    supportsReportCapability(report, 'stable_prefix_cache')
      ? formatDeepCodePrefixStatus(report.stablePrefix)
      : '',
    `API key: ${report.apiKeyConfigured ? 'configured' : 'missing'}`,
    supportsReportCapability(report, 'cache_breakpoint')
      ? formatDeepSeekCacheStatus(report.cacheStats, {
          stablePrefix: report.stablePrefix,
        })
      : '',
  ].filter(Boolean).join('\n')
}

export function deepCodeStatusReportToProperties(report) {
  const stats = report.cacheStats
  const rows = [
    { label: 'Provider', value: report.provider },
    { label: 'Base URL', value: report.config.baseUrl },
    { label: 'Model', value: report.config.model },
    { label: 'Small model', value: report.config.smallModel },
    {
      label: 'Context window',
      value: String(report.contextPolicy.contextWindowTokens),
    },
    {
      label: 'Effective context window',
      value: String(report.contextPolicy.effectiveContextWindowTokens),
    },
    {
      label: 'Auto compact',
      value: report.contextPolicy.autoCompactEnabled ? 'enabled' : 'disabled',
    },
    {
      label: 'Auto compact threshold',
      value: String(report.contextPolicy.autoCompactThresholdTokens),
    },
    supportsReportCapability(report, 'extended_thinking')
      ? { label: 'Thinking', value: report.config.thinking }
      : null,
    supportsReportCapability(report, 'reasoning_effort')
      ? { label: 'Reasoning effort', value: report.config.reasoningEffort }
      : null,
    { label: 'Harness mode', value: report.harnessConfig.mode },
    {
      label: 'Harness max agents',
      value: String(report.harnessConfig.maxAgents),
    },
    { label: 'Prompt pack', value: report.harnessConfig.promptPack },
    { label: 'Strict tools', value: report.harnessConfig.strictTools },
    {
      label: 'Harness runtime',
      value: report.harnessRuntimeDecision?.state ?? 'unavailable',
    },
    {
      label: 'Harness runtime reason',
      value: report.harnessRuntimeDecision?.reason ?? 'unavailable',
    },
    {
      label: 'Harness recommended profile',
      value: report.harnessRuntimeDecision?.recommendedProfile ?? 'unavailable',
    },
    {
      label: 'Harness delegation policy',
      value: report.harnessRuntimeDecision?.delegationPolicy ?? 'unavailable',
    },
    {
      label: 'Harness agent profile',
      value: report.harnessAgentLifecycle?.selectedProfile ?? 'unavailable',
    },
    {
      label: 'Harness agent selection',
      value: report.harnessAgentLifecycle?.selection ?? 'unavailable',
    },
    {
      label: 'Harness agent requested profile',
      value: report.harnessAgentLifecycle?.requestedProfile ?? 'unavailable',
    },
    {
      label: 'Harness agent delegation policy',
      value: report.harnessAgentLifecycle?.delegationPolicy ?? 'unavailable',
    },
    {
      label: 'Harness agent permission mode',
      value: report.harnessAgentLifecycle?.permissionMode ?? 'unavailable',
    },
    supportsReportCapability(report, 'user_id')
      ? { label: 'Cache user_id', value: report.config.cacheUserId }
      : null,
    supportsReportCapability(report, 'stable_prefix_cache')
      ? {
          label: 'Stable prefix hash',
          value: report.stablePrefix?.prefixHash ?? 'unknown',
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache prefix',
          value: formatCachePrefix(report),
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache last hit/miss',
          value: stats
            ? `${stats.lastPromptCacheHitTokens ?? 0}/${stats.lastPromptCacheMissTokens ?? 0}`
            : 'unavailable',
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache hit rate',
          value: stats ? formatRate(stats.lastPromptCacheHitRate) : 'unavailable',
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache total hit/miss',
          value: stats
            ? `${stats.totalPromptCacheHitTokens ?? 0}/${stats.totalPromptCacheMissTokens ?? 0}`
            : 'unavailable',
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache total hit rate',
          value: stats ? formatRate(stats.totalPromptCacheHitRate) : 'unavailable',
        }
      : null,
    supportsReportCapability(report, 'cache_breakpoint')
      ? {
          label: 'Cache telemetry updated',
          value: stats?.updatedAt ?? 'unavailable',
        }
      : null,
    {
      label: 'API key',
      value: report.apiKeyConfigured ? 'configured' : 'missing',
    },
  ]
  return rows.filter(Boolean)
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

function supportsReportCapability(report, capability) {
  if (report.providerCapabilities?.[capability] !== undefined) {
    return Boolean(report.providerCapabilities[capability])
  }
  return providerSupports(undefined, capability)
}
