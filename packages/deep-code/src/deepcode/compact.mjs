import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
  resolveDeepSeekConfig,
} from '../services/providers/deepseek.mjs'
import { createDeepSeekCacheDiagnostics } from '../cache/deepseek-cache.mjs'
import { createDeepCodeStablePrefix } from './stable-prefix.mjs'
import { providerSupports } from './provider-capabilities.mjs'

export async function compactDeepCodeConversation({
  messages = [],
  stablePrefix,
  env = process.env,
  cwd = process.cwd(),
  provider,
  maxTokens,
} = {}) {
  const modelProvider = provider ?? createDeepSeekProvider()
  const prefix =
    stablePrefix ?? (await createDeepCodeStablePrefix({ provider: modelProvider }))
  const config = resolveDeepSeekConfig({ env, cwd })
  const requestContext = omitUndefined({
    systemPrompt: prefix.systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildCompactPrompt(messages),
      },
    ],
    env,
    cwd,
    model: config.smallModel,
    maxTokens: Number(
      maxTokens ??
        env.DEEPCODE_COMPACT_MAX_TOKENS ??
        env.DEEPSEEK_COMPACT_MAX_TOKENS ??
        1024,
    ),
    thinking: providerSupports(modelProvider, 'extended_thinking')
      ? 'disabled'
      : undefined,
  })
  const request =
    typeof modelProvider.buildRequest === 'function'
      ? await modelProvider.buildRequest(requestContext)
      : await buildDeepSeekRequest(requestContext)
  const response = await collectDeepSeekStreamEvents(
    modelProvider.streamQuery(request),
  )
  const summary = response.content.trim()

  return {
    prefixBeforeHash: prefix.prefixHash,
    prefixAfterHash: prefix.prefixHash,
    summary,
    messages: summary
      ? [
          {
            role: 'user',
            content: `Compacted conversation summary:\n${summary}`,
          },
        ]
      : [],
    finishReason: response.finishReason,
    usage: response.usage,
    cacheDiagnostics: providerSupports(modelProvider, 'cache_breakpoint') && response.usage
      ? createDeepSeekCacheDiagnostics(response.usage)
      : null,
    request,
  }
}

export function formatDeepCodeCompactResult(result) {
  const diagnostics = result.cacheDiagnostics
  const hit = diagnostics?.promptCacheHitTokens ?? 0
  const miss = diagnostics?.promptCacheMissTokens ?? 0
  const hitRate = diagnostics
    ? `${(diagnostics.promptCacheHitRate * 100).toFixed(1)}%`
    : 'unknown'

  return [
    'DeepSeek prefix-preserving compact',
    `Stable prefix hash: ${result.prefixBeforeHash} -> ${result.prefixAfterHash}`,
    `Finish reason: ${result.finishReason ?? 'unknown'}`,
    `Summary chars: ${result.summary.length}`,
    `Post-compact messages: ${result.messages.length}`,
    diagnostics ? `Cache: hit=${hit} miss=${miss} hit_rate=${hitRate}` : '',
  ].filter(Boolean).join('\n')
}

function buildCompactPrompt(messages) {
  return [
    'Summarize the following volatile conversation tail for continuation.',
    [
      'Keep concrete user goals, decisions, file paths, commands, test results,',
      'tool outcomes, blockers, and next steps.',
    ].join(' '),
    [
      'Do not restate stable system instructions, tool manifests, skills',
      'manifests, or repository summary; those remain in the Deep Code stable prefix.',
    ].join(' '),
    'Return only the compact summary text.',
    '',
    'Conversation tail:',
    JSON.stringify(messages, null, 2),
  ].join('\n')
}

function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}
