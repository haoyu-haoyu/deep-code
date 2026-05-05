import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
} from '../services/providers/deepseek.mjs'
import { createDeepSeekCacheDiagnostics } from './deepseek-cache.mjs'
import { createDeepCodeStablePrefix } from '../deepcode/stable-prefix.mjs'

export async function createDeepSeekWarmupContext(options = {}) {
  return await createDeepCodeStablePrefix(options)
}

export async function warmDeepSeekCache({
  env = process.env,
  cwd = process.cwd(),
  provider,
  systemPrompt,
  tools = [],
  skills = [],
  repoSummary = '',
  stableHistory = [],
} = {}) {
  const context = await createDeepSeekWarmupContext({
    systemPrompt,
    tools,
    skills,
    repoSummary,
    stableHistory,
  })
  const request = await buildDeepSeekRequest({
    systemPrompt: context.systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Cache warm-up request. Reply exactly: ok',
      },
    ],
    tools,
    env,
    cwd,
    maxTokens: 8,
    thinking: 'disabled',
  })
  const modelProvider = provider ?? createDeepSeekProvider()
  const response = await collectDeepSeekStreamEvents(
    modelProvider.streamQuery(request),
  )

  return {
    prefixHash: context.prefixHash,
    content: response.content,
    finishReason: response.finishReason,
    usage: response.usage,
    cacheDiagnostics: response.usage
      ? createDeepSeekCacheDiagnostics(response.usage)
      : null,
    request,
  }
}

export function formatDeepSeekWarmupResult(result) {
  const diagnostics = result.cacheDiagnostics
  const hit = diagnostics?.promptCacheHitTokens ?? 0
  const miss = diagnostics?.promptCacheMissTokens ?? 0
  const hitRate = diagnostics
    ? `${(diagnostics.promptCacheHitRate * 100).toFixed(1)}%`
    : 'unknown'

  return [
    'DeepSeek cache warm-up',
    `Prefix hash: ${result.prefixHash}`,
    `Finish reason: ${result.finishReason ?? 'unknown'}`,
    `Response: ${JSON.stringify(result.content.trim())}`,
    `Cache: hit=${hit} miss=${miss} hit_rate=${hitRate}`,
  ].join('\n')
}
