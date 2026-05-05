import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_MEMORY_DIR,
  AGENT_MEMORY_LOCAL_DIR,
  AGENT_MEMORY_SNAPSHOT_DIR,
} from './agent-memory-paths.mjs'
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
import {
  DEEPCODE_INSTRUCTION_FILE,
  DEEPCODE_LOCAL_INSTRUCTION_FILE,
  DEEPCODE_PROJECT_DIR,
  LEGACY_CLAUDE_INSTRUCTION_FILE,
  LEGACY_CLAUDE_LOCAL_INSTRUCTION_FILE,
  LEGACY_CLAUDE_PROJECT_DIR,
} from './instruction-paths.mjs'

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
  const fullCliBundlePath = resolveFullCliBundlePath()
  add(
    'runtime.fullCliBundle',
    'Full CLI bundle',
    existsSync(fullCliBundlePath) ? 'pass' : 'fail',
    existsSync(fullCliBundlePath) ? 'available' : `missing at ${fullCliBundlePath}`,
    { path: fullCliBundlePath },
  )

  const shouldRunLive = live ?? Boolean(config.apiKey)
  const apiKeyStatus = config.apiKey ? 'pass' : shouldRunLive ? 'fail' : 'skip'
  const apiKeyDetail = config.apiKey
    ? 'configured'
    : shouldRunLive
      ? 'missing DEEPSEEK_API_KEY or DEEPCODE_API_KEY'
      : 'skipped by --no-live; set DEEPSEEK_API_KEY or DEEPCODE_API_KEY for live checks'
  add('config.apiKey', 'API key', apiKeyStatus, apiKeyDetail)
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

  const migrationDiagnostics = createDeepCodeMigrationDiagnostics({ env, cwd })
  add(
    'migration.deepCodePaths',
    'Deep Code migration paths',
    migrationDiagnostics.status,
    migrationDiagnostics.detail,
    migrationDiagnostics,
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
    'Request excludes legacy provider fields',
    /cache_control|redacted_thinking|signature_delta|anthropic/i.test(requestText)
      ? 'fail'
      : 'pass',
    'checked cache_control/redacted_thinking/signature_delta/legacy markers',
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

export function createDeepCodeMigrationDiagnostics({
  env = process.env,
  cwd = process.cwd(),
  exists = existsSync,
} = {}) {
  const primaryHome = resolveDeepCodeConfigHome(env)
  const legacyHome = resolveLegacyClaudeConfigHome(env)
  const pathPairs = [
    {
      label: 'Global settings',
      primary: join(primaryHome, 'settings.json'),
      legacy: join(legacyHome, 'settings.json'),
    },
    {
      label: 'Global skills',
      primary: join(primaryHome, 'skills'),
      legacy: join(legacyHome, 'skills'),
    },
    {
      label: 'Global agents',
      primary: join(primaryHome, 'agents'),
      legacy: join(legacyHome, 'agents'),
    },
    {
      label: 'Global agent memory',
      primary: join(primaryHome, AGENT_MEMORY_DIR),
      legacy: join(legacyHome, AGENT_MEMORY_DIR),
    },
    {
      label: 'Project instructions',
      primary: join(cwd, DEEPCODE_INSTRUCTION_FILE),
      legacy: join(cwd, LEGACY_CLAUDE_INSTRUCTION_FILE),
    },
    {
      label: 'Local instructions',
      primary: join(cwd, DEEPCODE_LOCAL_INSTRUCTION_FILE),
      legacy: join(cwd, LEGACY_CLAUDE_LOCAL_INSTRUCTION_FILE),
    },
    {
      label: 'Project settings',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, 'settings.json'),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, 'settings.json'),
    },
    {
      label: 'Local settings',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, 'settings.local.json'),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, 'settings.local.json'),
    },
    {
      label: 'Project skills',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, 'skills'),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, 'skills'),
    },
    {
      label: 'Project agents',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, 'agents'),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, 'agents'),
    },
    {
      label: 'Project rules',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, 'rules'),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, 'rules'),
    },
    {
      label: 'Project agent memory',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_DIR),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_DIR),
    },
    {
      label: 'Local agent memory',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_LOCAL_DIR),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_LOCAL_DIR),
    },
    {
      label: 'Project agent memory snapshots',
      primary: join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR),
      legacy: join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR),
    },
  ]

  const annotated = pathPairs.map(item => ({
    ...item,
    primaryExists: exists(item.primary),
    legacyExists: exists(item.legacy),
  }))
  const legacyOnly = annotated.filter(
    item => item.legacyExists && !item.primaryExists,
  )
  const bothPresent = annotated.filter(
    item => item.legacyExists && item.primaryExists,
  )
  const deepCodeOnly = annotated.filter(
    item => item.primaryExists && !item.legacyExists,
  )

  const detail =
    legacyOnly.length > 0
      ? `legacy fallback active for ${legacyOnly.map(item => item.label).join(', ')}`
      : bothPresent.length > 0
        ? `Deep Code paths active; legacy duplicates also present for ${bothPresent.map(item => item.label).join(', ')}`
        : 'Deep Code paths active'

  return {
    status: legacyOnly.length > 0 ? 'warn' : 'pass',
    detail,
    recommendation:
      legacyOnly.length > 0
        ? `Move project memory to ${DEEPCODE_INSTRUCTION_FILE}, project config and agent memory to ${DEEPCODE_PROJECT_DIR}/ when ready. Legacy ${LEGACY_CLAUDE_INSTRUCTION_FILE} and ${LEGACY_CLAUDE_PROJECT_DIR}/ remain readable as fallback.`
        : `Use ${DEEPCODE_INSTRUCTION_FILE} and ${DEEPCODE_PROJECT_DIR}/ for new Deep Code configuration.`,
    primaryHome,
    legacyHome,
    legacyOnly,
    bothPresent,
    deepCodeOnly,
  }
}

function resolveDeepCodeConfigHome(env) {
  return (
    env.DEEPCODE_CONFIG_DIR ||
    env.CLAUDE_CONFIG_DIR ||
    join(homedir(), '.deepcode')
  )
}

function resolveLegacyClaudeConfigHome(env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

function resolveFullCliBundlePath() {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'dist',
    'deepcode-full.mjs',
  )
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
    if (
      check.id === 'migration.deepCodePaths' &&
      check.metadata?.recommendation
    ) {
      lines.push(`    ${check.metadata.recommendation}`)
    }
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
