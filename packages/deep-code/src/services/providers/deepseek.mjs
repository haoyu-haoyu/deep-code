import {
  MODEL_PROVIDER_CAPABILITIES,
  assertModelProvider,
} from './types.mjs'
import {
  createDeepSeekCacheUserId,
} from '../../cache/deepseek-cache.mjs'
import {
  mapMessagesToDeepSeek,
  normalizeToolCalls,
  stringifyToolResultContent,
} from '../../messages/deepseek-normalizer.mjs'
import {
  sanitizeSchemaForDeepSeekStrict,
  toolToDeepSeekFunctionSchema,
} from '../../tools/deepseek-schema.mjs'
import { mapDeepSeekHttpError } from './deepseek-recovery.mjs'
import { loadDeepSeekConfigFile } from './deepseek-config-store.mjs'

export { mapMessagesToDeepSeek } from '../../messages/deepseek-normalizer.mjs'
export {
  calculateDeepSeekCacheHitRate,
  createDeepSeekCacheDiagnostics,
  createDeepSeekCacheUserId,
  createDeepSeekPrefixHash,
  createStableHash,
  stableJsonStringify,
} from '../../cache/deepseek-cache.mjs'
export {
  sanitizeSchemaForDeepSeekStrict,
  toolToDeepSeekFunctionSchema,
} from '../../tools/deepseek-schema.mjs'
export {
  DEEPSEEK_FINISH_ACTIONS,
  mapDeepSeekFinishReason,
  mapDeepSeekHttpError,
} from './deepseek-recovery.mjs'

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro'
export const DEFAULT_DEEPSEEK_SMALL_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_PROVIDER_CAPABILITIES = Object.freeze([
  MODEL_PROVIDER_CAPABILITIES.CACHE_DIAGNOSTICS,
  MODEL_PROVIDER_CAPABILITIES.JSON_OUTPUT,
  MODEL_PROVIDER_CAPABILITIES.REASONING_CONTENT,
  MODEL_PROVIDER_CAPABILITIES.STRICT_TOOLS,
  MODEL_PROVIDER_CAPABILITIES.STREAMING,
  MODEL_PROVIDER_CAPABILITIES.TOOL_CALLS,
])

export function resolveDeepSeekConfig({
  env = process.env,
  cwd = process.cwd(),
  overrides = {},
  fileConfig,
} = {}) {
  const file = fileConfig === undefined ? loadDeepSeekConfigFile({ env }) : fileConfig
  const thinkingType =
    overrides.thinking ??
    env.DEEPSEEK_THINKING ??
    env.DEEPCODE_THINKING ??
    file?.thinking ??
    'enabled'
  const thinkingEnabled = thinkingType !== 'disabled'

  return {
    apiKey:
      overrides.apiKey ??
      env.DEEPSEEK_API_KEY ??
      env.DEEPCODE_API_KEY ??
      env.API_KEY ??
      file?.apiKey,
    baseUrl: stripTrailingSlash(
      overrides.baseUrl ??
        env.DEEPSEEK_BASE_URL ??
        env.DEEPCODE_BASE_URL ??
        file?.baseUrl ??
        DEFAULT_DEEPSEEK_BASE_URL,
    ),
    model:
      overrides.model ??
      env.DEEPSEEK_MODEL ??
      env.DEEPCODE_MODEL ??
      file?.model ??
      DEFAULT_DEEPSEEK_MODEL,
    smallModel:
      overrides.smallModel ??
      env.DEEPSEEK_SMALL_MODEL ??
      env.DEEPCODE_SMALL_MODEL ??
      file?.smallModel ??
      DEFAULT_DEEPSEEK_SMALL_MODEL,
    thinking: thinkingEnabled ? 'enabled' : 'disabled',
    reasoningEffort: normalizeDeepSeekEffort(
      overrides.reasoningEffort ??
        env.DEEPSEEK_REASONING_EFFORT ??
        env.DEEPCODE_REASONING_EFFORT ??
        env.CLAUDE_CODE_EFFORT_LEVEL ??
        file?.reasoningEffort ??
        'max',
    ),
    cacheUserId:
      overrides.cacheUserId ??
      env.DEEPCODE_CACHE_USER_ID ??
      env.DEEPSEEK_CACHE_USER_ID ??
      createDeepSeekCacheUserId(cwd),
    // Re-send assistant reasoning_content on tool-call turns. Default true keeps
    // DeepSeek's reasoning-trajectory continuation (deepseekHarnessPrompts). Flip
    // to false only after a live cost probe (scripts/deepseek-reasoning-cost-probe.mjs).
    reasoningReplay:
      overrides.reasoningReplay ??
      envBool(env.DEEPCODE_REASONING_REPLAY ?? env.DEEPSEEK_REASONING_REPLAY) ??
      file?.reasoningReplay ??
      true,
  }
}

function envBool(value) {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  return undefined
}

export async function buildDeepSeekRequest({
  systemPrompt = [],
  messages = [],
  tools = [],
  env = process.env,
  cwd = process.cwd(),
  model,
  maxTokens,
  stream = true,
  strictTools = false,
  thinking,
  reasoningEffort,
  temperature,
  topP,
  toolChoice,
  toolSchemaOptions = {},
  responseFormat,
  userId,
  cacheUserId,
  reasoningReplay,
} = {}) {
  const config = resolveDeepSeekConfig({
    env,
    cwd,
    overrides: {
      reasoningReplay,
      model,
      thinking,
      reasoningEffort,
      cacheUserId: userId ?? cacheUserId,
    },
  })
  const baseUrl = strictTools
    ? ensureBetaBaseUrl(config.baseUrl)
    : config.baseUrl
  const thinkingEnabled = config.thinking !== 'disabled'

  const body = omitUndefined({
    model: config.model,
    messages: [
      ...systemPromptToMessages(systemPrompt),
      ...mapMessagesToDeepSeek(messages, {
        reasoningReplay: config.reasoningReplay,
      }),
    ],
    tools:
      tools.length > 0
        ? await Promise.all(
            [...tools]
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
              .map(tool =>
                toolToDeepSeekFunctionSchema(tool, {
                  ...toolSchemaOptions,
                  strict: strictTools,
                  tools: toolSchemaOptions.tools ?? tools,
                }),
              ),
          )
        : undefined,
    tool_choice: toolChoice,
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    reasoning_effort: thinkingEnabled ? config.reasoningEffort : undefined,
    max_tokens: maxTokens,
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
    response_format: responseFormat,
    user_id: config.cacheUserId,
    temperature: thinkingEnabled ? undefined : temperature,
    top_p: thinkingEnabled ? undefined : topP,
  })

  return {
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers: omitUndefined({
      'Content-Type': 'application/json',
      Authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined,
    }),
    body,
  }
}

export async function buildDeepSeekRouterRequest({
  systemPrompt = [],
  userPrompt = '',
  messages,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const routerMessages = Array.isArray(messages)
    ? messages
    : [{ role: 'user', content: userPrompt }]

  return await buildDeepSeekRequest({
    systemPrompt,
    messages: routerMessages,
    env,
    cwd,
    model: DEFAULT_DEEPSEEK_SMALL_MODEL,
    stream: false,
    thinking: 'disabled',
    temperature: 0,
    maxTokens: 80,
    responseFormat: { type: 'json_object' },
  })
}

export async function runDeepSeekAgent({
  prompt,
  messages = [],
  systemPrompt = [],
  tools = [],
  env = process.env,
  cwd = process.cwd(),
  provider,
  complete,
  maxTurns = 8,
  strictTools = false,
} = {}) {
  const modelProvider = provider ?? createDeepSeekProvider()
  if (complete !== undefined && typeof complete !== 'function') {
    throw new TypeError('runDeepSeekAgent complete must be a function when provided')
  }

  const conversation = [...messages]
  if (prompt) {
    conversation.push({ role: 'user', content: prompt })
  }
  const executableTools = new Map(tools.map(tool => [tool.name, tool]))
  let lastResponse = null

  for (let turn = 0; turn < maxTurns; turn++) {
    const request = await buildDeepSeekRequest({
      systemPrompt,
      messages: conversation,
      tools,
      env,
      cwd,
      strictTools,
    })
    const response =
      typeof complete === 'function'
        ? await complete(request)
        : await collectDeepSeekStreamEvents(modelProvider.streamQuery(request))
    lastResponse = response
    const toolCalls = normalizeToolCalls(response.toolCalls)

    if (toolCalls.length === 0) {
      return {
        content: response.content ?? '',
        reasoning: response.reasoning ?? '',
        usage: response.usage,
        messages: conversation,
      }
    }

    conversation.push({
      role: 'assistant',
      content: response.content ?? '',
      reasoning_content: response.reasoning ?? '',
      tool_calls: toolCalls,
    })

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name
      const tool = executableTools.get(toolName)
      const toolInput = parseToolArguments(toolCall.function.arguments)
      let content
      if (!tool) {
        content = `Tool ${toolName} is not available.`
      } else if (typeof tool.execute === 'function') {
        content = await tool.execute(toolInput, { cwd, env, toolCall })
      } else if (typeof tool.call === 'function') {
        content = await tool.call(toolInput)
      } else {
        content = `Tool ${toolName} has no executable handler.`
      }
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: stringifyToolResultContent(content),
      })
    }
  }

  return {
    content: lastResponse?.content ?? '',
    reasoning: lastResponse?.reasoning ?? '',
    usage: lastResponse?.usage,
    messages: conversation,
    stoppedReason: 'max_turns',
  }
}

export function createDeepSeekProvider(defaults = {}) {
  const capabilities = new Set(DEEPSEEK_PROVIDER_CAPABILITIES)

  return assertModelProvider({
    name: 'deepseek',

    streamQuery(context = {}) {
      return streamDeepSeekQuery({ ...defaults, ...context })
    },

    async buildRequest(context = {}) {
      return await buildDeepSeekRequest({ ...defaults, ...context })
    },

    parseStreamChunk(chunk) {
      return parseDeepSeekStreamChunk(chunk)
    },

    mapUsage(usage) {
      return mapDeepSeekUsage(usage)
    },

    supports(capability) {
      return capabilities.has(capability)
    },
  })
}

export async function* streamDeepSeekQuery(context = {}) {
  const request =
    context.url && context.method && context.headers && context.body
      ? context
      : await buildDeepSeekRequest(context)
  const fetchFn = context.fetch ?? globalThis.fetch
  const sleep = context.sleep ?? sleepMs
  const maxRetries = context.maxRetries ?? 2
  const requestTimeoutMs = resolveRequestTimeoutMs(context)
  let response

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeoutMs)
    timer.unref?.()
    const detachUserSignal = forwardAbortToController(context.signal, controller)

    try {
      response = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
        body:
          typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body),
      })
    } catch (error) {
      clearTimeout(timer)
      detachUserSignal()
      if (timedOut) {
        if (attempt === maxRetries) {
          throw createDeepSeekTimeoutError(request.url, requestTimeoutMs)
        }
        await sleep(calculateDeepSeekRetryDelayMs({}, attempt, context))
        continue
      }
      throw error
    }

    if (response.ok) {
      clearTimeout(timer)
      try {
        yield* streamDeepSeekResponseBody(response.body)
      } finally {
        detachUserSignal()
      }
      return
    }

    let text
    try {
      text = await response.text()
    } catch (error) {
      clearTimeout(timer)
      detachUserSignal()
      if (timedOut) {
        if (attempt === maxRetries) {
          throw createDeepSeekTimeoutError(request.url, requestTimeoutMs)
        }
        await sleep(calculateDeepSeekRetryDelayMs({}, attempt, context))
        continue
      }
      throw error
    }
    clearTimeout(timer)
    detachUserSignal()

    const recovery = mapDeepSeekHttpError({
      status: response.status,
      headers: response.headers,
      message: text,
    })
    if (!recovery.retryable || attempt === maxRetries) {
      throw createDeepSeekApiError(response.status, text, recovery)
    }

    await sleep(calculateDeepSeekRetryDelayMs(recovery, attempt, context))
  }

  throw new Error(`DeepSeek API exhausted retries`)
}

function resolveRequestTimeoutMs(context) {
  if (Number.isFinite(context.requestTimeoutMs) && context.requestTimeoutMs > 0) {
    return context.requestTimeoutMs
  }
  const raw =
    context.env?.DEEPCODE_REQUEST_TIMEOUT_MS ??
    process.env.DEEPCODE_REQUEST_TIMEOUT_MS
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 300_000
}

function forwardAbortToController(userSignal, controller) {
  if (!userSignal) return () => {}
  if (userSignal.aborted) {
    controller.abort(userSignal.reason)
    return () => {}
  }
  const handler = () => controller.abort(userSignal.reason)
  userSignal.addEventListener('abort', handler, { once: true })
  return () => userSignal.removeEventListener('abort', handler)
}

function createDeepSeekTimeoutError(url, timeoutMs) {
  const error = new Error(
    `DeepSeek API request timed out after ${timeoutMs}ms (no response from ${url}). ` +
      `Override with DEEPCODE_REQUEST_TIMEOUT_MS.`,
  )
  error.code = 'DEEPCODE_REQUEST_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

export function calculateDeepSeekRetryDelayMs(
  recovery,
  attempt,
  { retryBaseDelayMs = 500, retryMaxDelayMs = 8000 } = {},
) {
  if (recovery.retryAfterSeconds !== undefined) {
    return recovery.retryAfterSeconds * 1000
  }
  return Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** attempt)
}

export async function* streamDeepSeekResponseBody(body) {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const event of parseDeepSeekSSELines(lines)) {
      yield event
    }
  }

  if (buffer.trim()) {
    for (const event of parseDeepSeekSSELines([buffer])) {
      yield event
    }
  }
}

export async function collectDeepSeekStreamEvents(events, { onContent } = {}) {
  let content = ''
  let reasoning = ''
  let usage = null
  let finishReason = null
  const toolCalls = new Map()

  for await (const event of events) {
    if (event.type === 'reasoning_delta') {
      reasoning += event.text
    } else if (event.type === 'content_delta') {
      content += event.text
      onContent?.(event.text)
    } else if (event.type === 'tool_call_delta') {
      mergeDeepSeekToolCallDelta(toolCalls, event)
      if (event.finishReason) finishReason = event.finishReason
    } else if (event.type === 'finish') {
      finishReason = event.finishReason
    } else if (event.type === 'usage') {
      usage = event.usage
    }
  }

  return {
    content,
    reasoning,
    usage,
    finishReason,
    toolCalls: [...toolCalls.values()],
  }
}

export function mergeDeepSeekToolCallDelta(toolCalls, event) {
  const index = event.index ?? 0
  const existing =
    toolCalls.get(index) ??
    {
      id: event.id,
      type: 'function',
      function: { name: event.name, arguments: '' },
    }
  if (event.id) existing.id = event.id
  if (event.name) existing.function.name = event.name
  if (event.argumentsDelta) existing.function.arguments += event.argumentsDelta
  toolCalls.set(index, existing)
  return existing
}

export function parseDeepSeekStreamChunk(chunk) {
  const text =
    typeof chunk === 'string'
      ? chunk
      : new TextDecoder().decode(chunk, { stream: false })
  return parseDeepSeekSSELines(text.split(/\r?\n/))
}

export function parseDeepSeekSSELines(lines) {
  const events = []
  for (const line of lines) {
    const trimmed = String(line).trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue

    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      events.push({ type: 'done' })
      continue
    }

    // ROBUSTNESS: a single malformed / truncated `data:` line (network glitch,
    // proxy interference, or a connection dropped mid-message so the
    // final-buffer flush sees partial JSON) must NOT abort the whole stream —
    // skip it and keep parsing the rest. Previously an unguarded JSON.parse
    // threw, crashing streamDeepSeekResponseBody and losing all already-received
    // content.
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}
      if (delta.reasoning_content) {
        events.push({ type: 'reasoning_delta', text: delta.reasoning_content })
      }
      if (delta.content) {
        events.push({ type: 'content_delta', text: delta.content })
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const event = omitUndefined({
          type: 'tool_call_delta',
          index: toolCall.index,
          id: toolCall.id,
          name: toolCall.function?.name,
          argumentsDelta: toolCall.function?.arguments,
          finishReason: choice.finish_reason ?? undefined,
        })
        events.push(event)
      }
      const hasToolCallDeltas = (delta.tool_calls?.length ?? 0) > 0
      if (
        choice.finish_reason &&
        !delta.reasoning_content &&
        !delta.content &&
        !hasToolCallDeltas
      ) {
        events.push({ type: 'finish', finishReason: choice.finish_reason })
      }
    }
    if (chunk.usage) {
      events.push({ type: 'usage', usage: mapDeepSeekUsage(chunk.usage) })
    }
  }
  return events
}

export function mapDeepSeekUsage(usage = {}) {
  return {
    ...(usage.prompt_cache_hit_tokens !== undefined && {
      prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
    }),
    ...(usage.prompt_cache_miss_tokens !== undefined && {
      prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens,
    }),
    ...(usage.prompt_tokens !== undefined && {
      prompt_tokens: usage.prompt_tokens,
    }),
    ...(usage.completion_tokens !== undefined && {
      completion_tokens: usage.completion_tokens,
    }),
    ...(usage.total_tokens !== undefined && {
      total_tokens: usage.total_tokens,
    }),
    ...(usage.completion_tokens_details?.reasoning_tokens !== undefined && {
      reasoning_tokens: usage.completion_tokens_details.reasoning_tokens,
    }),
  }
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) return {}
  if (typeof rawArguments !== 'string') return rawArguments
  try {
    return JSON.parse(rawArguments)
  } catch {
    return { _raw: rawArguments }
  }
}

function systemPromptToMessages(systemPrompt) {
  if (Array.isArray(systemPrompt)) {
    const content = systemPrompt.filter(Boolean).join('\n\n')
    return content ? [{ role: 'system', content }] : []
  }
  return systemPrompt ? [{ role: 'system', content: String(systemPrompt) }] : []
}

function normalizeDeepSeekEffort(value) {
  const normalized = String(value ?? 'max').toLowerCase()
  if (normalized === 'max' || normalized === 'xhigh') return 'max'
  return 'high'
}

function ensureBetaBaseUrl(baseUrl) {
  return baseUrl.endsWith('/beta') ? baseUrl : `${baseUrl}/beta`
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '')
}

function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createDeepSeekApiError(status, message, recovery) {
  const error = new Error(`DeepSeek API ${status}: ${message}`)
  error.status = status
  error.recovery = recovery
  return error
}
