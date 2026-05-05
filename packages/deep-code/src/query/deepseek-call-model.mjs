import { randomUUID } from 'node:crypto'
import {
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
  mapDeepSeekFinishReason,
} from '../deepcode/deepseek-native.mjs'
import {
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from '../deepcode/cache-telemetry.mjs'
import { createDeepCodeStablePrefix } from '../deepcode/stable-prefix.mjs'
import { resolveDeepSeekConfig } from '../services/providers/deepseek.mjs'

export function createDeepSeekCallModel({
  provider = createDeepSeekProvider(),
  now = () => new Date(),
  uuid = randomUUID,
} = {}) {
  return async function* queryDeepSeekModelWithStreaming({
    messages = [],
    systemPrompt = [],
    tools = [],
    signal,
    options = {},
  } = {}) {
    if (signal?.aborted) {
      throw new Error('DeepSeek query aborted before start')
    }

    const toolSchemaOptions = {
      getToolPermissionContext: options.getToolPermissionContext,
      tools,
      agents: options.agents,
      allowedAgentTypes: options.allowedAgentTypes,
    }
    const stablePrefix = await createDeepCodeStablePrefix({
      systemPrompt,
      tools,
      toolSchemaOptions,
    })

    const response = await collectDeepSeekStreamEvents(provider.streamQuery({
      systemPrompt: stablePrefix.systemPrompt,
      messages,
      tools,
      toolSchemaOptions,
      stablePrefix,
      env: process.env,
      cwd: process.cwd(),
      model: resolveDeepSeekRuntimeModel(options.model),
      reasoningEffort: resolveDeepSeekReasoningEffort(options.effortValue),
      maxTokens: options.maxOutputTokensOverride,
      toolChoice: options.toolChoice,
      signal,
      fetch: options.fetchOverride,
    }))

    await recordQueryCacheUsage(response.usage, stablePrefix)

    yield deepSeekResponseToAssistantMessage(response, {
      model: resolveDeepSeekRuntimeModel(options.model) ?? 'deepseek-v4-pro',
      now,
      uuid,
    })
  }
}

async function recordQueryCacheUsage(usage, stablePrefix) {
  if (!usage) return
  const config = resolveDeepSeekConfig({
    env: process.env,
    cwd: process.cwd(),
  })
  const path = resolveDeepSeekCacheStatsPath({
    env: process.env,
    config,
  })
  await recordDeepSeekCacheUsage({
    path,
    usage,
    stablePrefix,
  })
}

export function resolveDeepSeekRuntimeModel(model) {
  if (typeof model === 'string' && model.startsWith('deepseek')) {
    return model
  }
  return process.env.DEEPSEEK_MODEL ?? process.env.DEEPCODE_MODEL
}

export function resolveDeepSeekReasoningEffort(effortValue) {
  if (effortValue === undefined || effortValue === null) return undefined
  const normalized =
    typeof effortValue === 'string'
      ? effortValue.toLowerCase()
      : String(effortValue).toLowerCase()
  if (normalized === 'max' || normalized === 'xhigh') return 'max'
  return 'high'
}

export function deepSeekResponseToAssistantMessage(
  response,
  { model = 'deepseek-v4-pro', now = () => new Date(), uuid = randomUUID } = {},
) {
  const messageId = `msg_deepseek_${uuid()}`
  const content = []

  if (response.reasoning && response.toolCalls?.length > 0) {
    content.push({
      type: 'thinking',
      thinking: response.reasoning,
    })
  }

  if (response.content) {
    content.push({
      type: 'text',
      text: response.content,
    })
  }

  for (const toolCall of response.toolCalls ?? []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolArguments(toolCall.function.arguments),
    })
  }

  const finish = mapDeepSeekFinishReason(response.finishReason)

  return {
    type: 'assistant',
    uuid: uuid(),
    timestamp: now().toISOString(),
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: mapStopReasonForClaudeCode(finish.finishReason),
      stop_sequence: null,
      usage: mapUsageForClaudeCode(response.usage),
    },
  }
}

function mapStopReasonForClaudeCode(finishReason) {
  if (finishReason === 'tool_calls') return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  if (!finishReason || finishReason === 'unknown') return null
  return finishReason
}

function mapUsageForClaudeCode(usage = {}) {
  usage ??= {}
  const cacheHit = usage.prompt_cache_hit_tokens ?? 0
  const cacheMiss = usage.prompt_cache_miss_tokens ?? 0
  return {
    input_tokens: usage.prompt_tokens ?? cacheHit + cacheMiss,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: cacheMiss,
    cache_read_input_tokens: cacheHit,
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
