import { createHash } from 'node:crypto'
import {
  MODEL_PROVIDER_CAPABILITIES,
  assertModelProvider,
} from './types.mjs'

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

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
])

export function createDeepSeekCacheUserId(workspacePath) {
  const hash = createHash('sha256')
    .update(String(workspacePath || process.cwd()))
    .digest('base64url')
    .slice(0, 32)
  return `dc_${hash}`
}

export function resolveDeepSeekConfig({
  env = process.env,
  cwd = process.cwd(),
  overrides = {},
} = {}) {
  const thinkingType =
    overrides.thinking ??
    env.DEEPSEEK_THINKING ??
    env.DEEPCODE_THINKING ??
    'enabled'
  const thinkingEnabled = thinkingType !== 'disabled'

  return {
    apiKey:
      overrides.apiKey ??
      env.DEEPSEEK_API_KEY ??
      env.DEEPCODE_API_KEY ??
      env.API_KEY,
    baseUrl: stripTrailingSlash(
      overrides.baseUrl ??
        env.DEEPSEEK_BASE_URL ??
        env.DEEPCODE_BASE_URL ??
        DEFAULT_DEEPSEEK_BASE_URL,
    ),
    model:
      overrides.model ??
      env.DEEPSEEK_MODEL ??
      env.DEEPCODE_MODEL ??
      DEFAULT_DEEPSEEK_MODEL,
    smallModel:
      overrides.smallModel ??
      env.DEEPSEEK_SMALL_MODEL ??
      env.DEEPCODE_SMALL_MODEL ??
      DEFAULT_DEEPSEEK_SMALL_MODEL,
    thinking: thinkingEnabled ? 'enabled' : 'disabled',
    reasoningEffort: normalizeDeepSeekEffort(
      overrides.reasoningEffort ??
        env.DEEPSEEK_REASONING_EFFORT ??
        env.DEEPCODE_REASONING_EFFORT ??
        env.CLAUDE_CODE_EFFORT_LEVEL ??
        'max',
    ),
    cacheUserId:
      overrides.cacheUserId ??
      env.DEEPCODE_CACHE_USER_ID ??
      env.DEEPSEEK_CACHE_USER_ID ??
      createDeepSeekCacheUserId(cwd),
  }
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
  responseFormat,
  userId,
  cacheUserId,
} = {}) {
  const config = resolveDeepSeekConfig({
    env,
    cwd,
    overrides: {
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
      ...mapMessagesToDeepSeek(messages),
    ],
    tools:
      tools.length > 0
        ? await Promise.all(
            [...tools]
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
              .map(tool =>
                toolToDeepSeekFunctionSchema(tool, { strict: strictTools }),
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

export async function runDeepSeekAgent({
  prompt,
  messages = [],
  systemPrompt = [],
  tools = [],
  env = process.env,
  cwd = process.cwd(),
  complete,
  maxTurns = 8,
  strictTools = false,
} = {}) {
  if (typeof complete !== 'function') {
    throw new TypeError('runDeepSeekAgent requires a complete(request) function')
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
    const response = await complete(request)
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
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body:
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`DeepSeek API ${response.status}: ${text}`)
  }

  yield* streamDeepSeekResponseBody(response.body)
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

export function parseDeepSeekStreamChunk(chunk) {
  const text =
    typeof chunk === 'string'
      ? chunk
      : new TextDecoder().decode(chunk, { stream: false })
  return parseDeepSeekSSELines(text.split(/\r?\n/))
}

export function mapMessagesToDeepSeek(messages) {
  const mapped = []
  for (const message of messages) {
    if (!message) continue

    if (message.role) {
      mapped.push(...mapOpenAIStyleMessage(message))
      continue
    }

    if (message.type === 'user') {
      mapped.push(...mapClaudeCodeUserMessage(message))
      continue
    }

    if (message.type === 'assistant') {
      mapped.push(mapClaudeCodeAssistantMessage(message))
    }
  }
  return mapped
}

export async function toolToDeepSeekFunctionSchema(tool, options = {}) {
  const description = await resolveToolDescription(tool, options)
  const rawParameters =
    tool.inputJSONSchema ??
    tool.input_schema ??
    tool.parameters ??
    tool.function?.parameters ??
    emptyObjectSchema()
  const parameters = options.strict
    ? sanitizeSchemaForDeepSeekStrict(rawParameters)
    : stableClone(rawParameters)

  return {
    type: 'function',
    function: omitUndefined({
      name: tool.name ?? tool.function?.name,
      description,
      parameters,
      strict: options.strict ? true : undefined,
    }),
  }
}

export function sanitizeSchemaForDeepSeekStrict(schema) {
  if (Array.isArray(schema)) {
    return schema.map(item => sanitizeSchemaForDeepSeekStrict(item))
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const out = {}
  for (const key of Object.keys(schema).sort()) {
    if (UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key)) continue
    const value = schema[key]
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {}
      for (const prop of Object.keys(value).sort()) {
        out.properties[prop] = sanitizeSchemaForDeepSeekStrict(value[prop])
      }
      continue
    }
    if (key === 'items') {
      out.items = sanitizeSchemaForDeepSeekStrict(value)
      continue
    }
    if (key === 'anyOf' && Array.isArray(value)) {
      out.anyOf = value.map(item => sanitizeSchemaForDeepSeekStrict(item))
      continue
    }
    if ((key === '$defs' || key === '$def') && value && typeof value === 'object') {
      out[key] = {}
      for (const defName of Object.keys(value).sort()) {
        out[key][defName] = sanitizeSchemaForDeepSeekStrict(value[defName])
      }
      continue
    }
    out[key] = sanitizeSchemaForDeepSeekStrict(value)
  }

  if (out.type === 'object' || out.properties) {
    const propertyNames = Object.keys(out.properties ?? {}).sort()
    out.type = out.type ?? 'object'
    out.required = propertyNames
    out.additionalProperties = false
  }

  return out
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

    const chunk = JSON.parse(payload)
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
      if (
        choice.finish_reason &&
        choice.finish_reason !== 'tool_calls' &&
        !delta.reasoning_content &&
        !delta.content &&
        !delta.tool_calls
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

export function calculateDeepSeekCacheHitRate(usage = {}) {
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  const total = hit + miss
  return total === 0 ? 0 : hit / total
}

function mapOpenAIStyleMessage(message) {
  if (message.role === 'assistant') {
    const toolCalls = normalizeToolCalls(message.tool_calls)
    return [
      omitUndefined({
        role: 'assistant',
        content: message.content ?? '',
        reasoning_content:
          toolCalls.length > 0 ? message.reasoning_content : undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        name: message.name,
      }),
    ]
  }

  if (message.role === 'tool') {
    return [
      {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: stringifyToolResultContent(message.content),
      },
    ]
  }

  return [
    omitUndefined({
      role: message.role,
      content: stringifyTextContent(message.content),
      name: message.name,
    }),
  ]
}

function mapClaudeCodeUserMessage(message) {
  const content = message.message?.content ?? message.content
  if (!Array.isArray(content)) {
    return [{ role: 'user', content: String(content ?? '') }]
  }

  const result = []
  const textParts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'tool_result') {
      result.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: stringifyToolResultContent(block.content),
      })
      continue
    }
    if (block.type === 'text') {
      textParts.push(block.text ?? '')
    }
  }
  if (textParts.length > 0) {
    result.unshift({ role: 'user', content: textParts.join('\n') })
  }
  return result
}

function mapClaudeCodeAssistantMessage(message) {
  const content = message.message?.content ?? message.content
  if (!Array.isArray(content)) {
    return { role: 'assistant', content: String(content ?? '') }
  }

  const textParts = []
  const reasoningParts = []
  const toolCalls = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text') {
      textParts.push(block.text ?? '')
    } else if (block.type === 'thinking') {
      reasoningParts.push(block.thinking ?? '')
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}),
        },
      })
    }
  }

  return omitUndefined({
    role: 'assistant',
    content: textParts.join(''),
    reasoning_content:
      toolCalls.length > 0 && reasoningParts.length > 0
        ? reasoningParts.join('\n')
        : undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  })
}

function normalizeToolCalls(toolCalls) {
  return (toolCalls ?? []).map(call => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.function?.name ?? call.name,
      arguments:
        typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : typeof call.arguments === 'string'
            ? call.arguments
            : JSON.stringify(call.input ?? {}),
    },
  }))
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

async function resolveToolDescription(tool, options) {
  if (typeof tool.prompt === 'function') {
    return await tool.prompt({
      getToolPermissionContext:
        options.getToolPermissionContext ?? (async () => ({})),
      tools: options.tools ?? [],
      agents: options.agents ?? [],
      allowedAgentTypes: options.allowedAgentTypes,
    })
  }
  if (typeof tool.description === 'string') return tool.description
  if (typeof tool.function?.description === 'string') {
    return tool.function.description
  }
  return ''
}

function systemPromptToMessages(systemPrompt) {
  if (Array.isArray(systemPrompt)) {
    const content = systemPrompt.filter(Boolean).join('\n\n')
    return content ? [{ role: 'system', content }] : []
  }
  return systemPrompt ? [{ role: 'system', content: String(systemPrompt) }] : []
}

function stringifyTextContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

function stringifyToolResultContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      return JSON.stringify(block)
    })
    .join('\n')
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

function emptyObjectSchema() {
  return { type: 'object', properties: {}, required: [] }
}

function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = stableClone(value[key])
  }
  return out
}
