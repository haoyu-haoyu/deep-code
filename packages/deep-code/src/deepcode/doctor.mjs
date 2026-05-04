import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekCacheDiagnostics,
  createDeepSeekProvider,
  parseDeepSeekSSELines,
  resolveDeepSeekConfig,
} from './deepseek-native.mjs'
import {
  MODEL_PROVIDER_CAPABILITIES,
  resolveModelProvider,
} from '../services/providers/index.mjs'

const DOCTOR_TOOL = {
  name: 'DoctorEcho',
  description: 'Echoes a diagnostic string for Deep Code doctor checks.',
  inputJSONSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
  },
}

export async function createDeepSeekDoctorReport({
  env = process.env,
  cwd = process.cwd(),
  live,
  provider,
} = {}) {
  const config = resolveDeepSeekConfig({ env, cwd })
  const checks = []
  const add = (id, label, status, detail, metadata) => {
    checks.push({ id, label, status, detail, metadata })
  }

  const modelProvider = resolveModelProvider({
    env,
    defaults: { env, cwd },
  })
  add(
    'provider.deepseek',
    'Provider registry',
    modelProvider.name === 'deepseek' ? 'pass' : 'fail',
    `resolved=${modelProvider.name}`,
  )

  const missingCapabilities = [
    MODEL_PROVIDER_CAPABILITIES.STREAMING,
    MODEL_PROVIDER_CAPABILITIES.TOOL_CALLS,
    MODEL_PROVIDER_CAPABILITIES.REASONING_CONTENT,
    MODEL_PROVIDER_CAPABILITIES.CACHE_DIAGNOSTICS,
  ].filter(capability => !modelProvider.supports(capability))
  add(
    'provider.capabilities',
    'DeepSeek provider capabilities',
    missingCapabilities.length === 0 ? 'pass' : 'fail',
    missingCapabilities.length === 0
      ? 'streaming/tool_calls/reasoning/cache diagnostics enabled'
      : `missing=${missingCapabilities.join(',')}`,
  )

  add(
    'config.apiKey',
    'API key',
    config.apiKey ? 'pass' : 'fail',
    config.apiKey ? 'configured' : 'missing DEEPSEEK_API_KEY or DEEPCODE_API_KEY',
  )
  add(
    'config.baseUrl',
    'Base URL',
    /^https?:\/\//.test(config.baseUrl) ? 'pass' : 'fail',
    config.baseUrl,
  )
  add(
    'config.cacheUserId',
    'Cache user_id',
    config.cacheUserId ? 'pass' : 'fail',
    config.cacheUserId || 'missing',
  )

  const request = await buildDeepSeekRequest({
    systemPrompt: ['Deep Code doctor request shape check.'],
    messages: [{ role: 'user', content: 'ping' }],
    tools: [DOCTOR_TOOL],
    env,
    cwd,
    maxTokens: 16,
    thinking: 'disabled',
  })
  const requestText = JSON.stringify(request.body)
  add(
    'request.noAnthropicFields',
    'Request excludes Anthropic-only fields',
    /cache_control|redacted_thinking|signature_delta|anthropic/i.test(requestText)
      ? 'fail'
      : 'pass',
    'checked cache_control/redacted_thinking/signature_delta/anthropic markers',
  )
  add(
    'request.streamUsage',
    'Streaming usage telemetry',
    request.body.stream === true &&
      request.body.stream_options?.include_usage === true
      ? 'pass'
      : 'fail',
    JSON.stringify(request.body.stream_options ?? null),
  )
  add(
    'request.toolSchema',
    'Function tool schema',
    request.body.tools?.[0]?.type === 'function' &&
      request.body.tools?.[0]?.function?.parameters?.type === 'object'
      ? 'pass'
      : 'fail',
    request.body.tools?.[0]?.function?.name ?? 'missing',
  )

  const parserEvents = parseDeepSeekSSELines([
    ': keep-alive',
    'data: {"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_cache_hit_tokens":3,"prompt_cache_miss_tokens":1}}',
    'data: [DONE]',
  ])
  add(
    'stream.parser',
    'SSE parser',
    parserEvents.some(event => event.type === 'content_delta') &&
      parserEvents.some(event => event.type === 'usage')
      ? 'pass'
      : 'fail',
    'keep-alive/content/reasoning/usage parsed',
  )

  const cacheDiagnostics = createDeepSeekCacheDiagnostics({
    prompt_cache_hit_tokens: 3,
    prompt_cache_miss_tokens: 1,
  })
  add(
    'cache.diagnostics',
    'Cache diagnostics',
    cacheDiagnostics.promptCacheHitRate === 0.75 ? 'pass' : 'fail',
    `hit_rate=${(cacheDiagnostics.promptCacheHitRate * 100).toFixed(1)}%`,
    cacheDiagnostics,
  )

  const shouldRunLive = live ?? Boolean(config.apiKey)
  let liveUsage = null
  if (shouldRunLive) {
    if (!config.apiKey) {
      add(
        'live.api',
        'Live DeepSeek streaming request',
        'fail',
        'missing API key',
      )
    } else {
      try {
        const liveRequest = await buildDeepSeekRequest({
          systemPrompt: ['You are Deep Code doctor. Output only ok.'],
          messages: [{ role: 'user', content: 'Reply exactly: ok' }],
          env,
          cwd,
          maxTokens: 16,
          thinking: 'disabled',
        })
        const liveProvider = provider ?? createDeepSeekProvider()
        const response = await collectDeepSeekStreamEvents(
          liveProvider.streamQuery(liveRequest),
        )
        liveUsage = response.usage
        add(
          'live.api',
          'Live DeepSeek streaming request',
          response.content.trim() ? 'pass' : 'warn',
          `finish=${response.finishReason ?? 'unknown'} content=${JSON.stringify(response.content.trim())}`,
        )
        add(
          'live.cacheTelemetry',
          'Live cache telemetry',
          response.usage &&
            (response.usage.prompt_cache_hit_tokens !== undefined ||
              response.usage.prompt_cache_miss_tokens !== undefined)
            ? 'pass'
            : 'warn',
          response.usage
            ? `hit=${response.usage.prompt_cache_hit_tokens ?? 0} miss=${response.usage.prompt_cache_miss_tokens ?? 0}`
            : 'usage chunk missing',
          response.usage ? createDeepSeekCacheDiagnostics(response.usage) : null,
        )
      } catch (error) {
        add(
          'live.api',
          'Live DeepSeek streaming request',
          'fail',
          error?.message ?? String(error),
        )
      }
    }
  } else {
    add(
      'live.api',
      'Live DeepSeek streaming request',
      'skip',
      'disabled by --no-live or missing key',
    )
  }

  return {
    config: {
      provider: modelProvider.name,
      baseUrl: config.baseUrl,
      model: config.model,
      smallModel: config.smallModel,
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
      cacheUserId: config.cacheUserId,
      apiKeyConfigured: Boolean(config.apiKey),
    },
    checks,
    liveUsage,
    summary: summarizeChecks(checks),
  }
}

export function formatDeepSeekDoctorReport(report) {
  const lines = [
    'Deep Code Doctor',
    `Provider: ${report.config.provider}`,
    `Base URL: ${report.config.baseUrl}`,
    `Model: ${report.config.model}`,
    `Small model: ${report.config.smallModel}`,
    `Thinking: ${report.config.thinking}`,
    `Reasoning effort: ${report.config.reasoningEffort}`,
    `Cache user_id: ${report.config.cacheUserId}`,
    `API key: ${report.config.apiKeyConfigured ? 'configured' : 'missing'}`,
    '',
  ]

  for (const check of report.checks) {
    lines.push(
      `[${formatStatus(check.status)}] ${check.label}: ${check.detail}`,
    )
  }

  lines.push(
    '',
    `Summary: pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail} skip=${report.summary.skip}`,
  )
  return lines.join('\n')
}

export function hasFailingDoctorChecks(report) {
  return report.summary.fail > 0
}

function summarizeChecks(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 }
  for (const check of checks) {
    summary[check.status] = (summary[check.status] ?? 0) + 1
  }
  return summary
}

function formatStatus(status) {
  if (status === 'pass') return 'OK'
  if (status === 'warn') return 'WARN'
  if (status === 'fail') return 'FAIL'
  return 'SKIP'
}
