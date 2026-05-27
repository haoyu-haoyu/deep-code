import { randomUUID } from 'node:crypto'
import {
  createDeepSeekProvider,
  mapDeepSeekFinishReason,
} from '../deepcode/deepseek-native.mjs'
import {
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from '../deepcode/cache-telemetry.mjs'
import { providerSupports } from '../deepcode/provider-capabilities.mjs'
import { createDeepCodeStablePrefix } from '../deepcode/stable-prefix.mjs'
import { resolveDeepCodeRequestMaxTokens } from '../deepcode/context-policy.mjs'
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

    const runtimeModel = resolveDeepSeekRuntimeModel(options.model)
    const messageId = `msg_deepseek_${uuid()}`

    yield streamEvent({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: runtimeModel ?? 'deepseek-v4-pro',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    const stream = provider.streamQuery(createProviderStreamContext({
      provider,
      systemPrompt: stablePrefix.systemPrompt,
      messages,
      tools,
      toolSchemaOptions,
      stablePrefix,
      env: process.env,
      cwd: process.cwd(),
      model: runtimeModel,
      reasoningEffort: resolveDeepSeekReasoningEffort(options.effortValue),
      maxTokens:
        options.maxOutputTokensOverride ??
        resolveDeepCodeRequestMaxTokens({
          env: process.env,
          model: runtimeModel,
        }),
      toolChoice: options.toolChoice,
      signal,
      fetch: options.fetchOverride,
    }))

    const state = createStreamingState()

    for await (const event of stream) {
      if (signal?.aborted) break

      if (event.type === 'reasoning_delta') {
        if (!providerSupports(provider, 'reasoning_content')) continue
        state.reasoning += event.text
        if (!state.thinkingOpen) {
          yield streamEvent({
            type: 'content_block_start',
            index: state.blockIndex,
            content_block: { type: 'thinking', thinking: '' },
          })
          state.thinkingOpen = true
        }
        yield streamEvent({
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: { type: 'thinking_delta', thinking: event.text },
        })
        continue
      }

      if (event.type === 'content_delta') {
        for (const closed of closeThinkingIfOpen(state)) yield closed
        state.content += event.text
        if (!state.textOpen) {
          yield streamEvent({
            type: 'content_block_start',
            index: state.blockIndex,
            content_block: { type: 'text', text: '' },
          })
          state.textOpen = true
        }
        yield streamEvent({
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: { type: 'text_delta', text: event.text },
        })
        continue
      }

      if (event.type === 'tool_call_delta') {
        const toolIndex = event.index ?? 0
        let entry = state.toolCalls.get(toolIndex)
        if (!entry) {
          for (const closed of closeOpenInlineBlocks(state)) yield closed
          entry = {
            blockIndex: state.blockIndex,
            id: event.id ?? `toolu_deepseek_${uuid()}`,
            name: event.name ?? '',
            args: '',
          }
          state.toolCalls.set(toolIndex, entry)
          yield streamEvent({
            type: 'content_block_start',
            index: entry.blockIndex,
            content_block: {
              type: 'tool_use',
              id: entry.id,
              name: entry.name,
              input: {},
            },
          })
          state.openToolBlockIndices.add(entry.blockIndex)
          state.blockIndex += 1
        }
        if (event.id) entry.id = event.id
        if (event.name) entry.name = event.name
        if (event.argumentsDelta) {
          entry.args += event.argumentsDelta
          yield streamEvent({
            type: 'content_block_delta',
            index: entry.blockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: event.argumentsDelta,
            },
          })
        }
        if (event.finishReason) state.finishReason = event.finishReason
        continue
      }

      if (event.type === 'finish') {
        state.finishReason = event.finishReason
        continue
      }

      if (event.type === 'usage') {
        state.usage = event.usage
        continue
      }
    }

    for (const closed of closeAllOpenBlocks(state)) yield closed

    const finish = mapDeepSeekFinishReason(state.finishReason)
    const stopReason = mapStopReasonForClaudeCode(finish.finishReason)
    const usageMapped = mapUsageForClaudeCode(state.usage)

    yield streamEvent({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: usageMapped,
    })
    yield streamEvent({ type: 'message_stop' })

    const aggregatedToolCalls = Array.from(state.toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, entry]) => ({
        id: entry.id,
        type: 'function',
        function: { name: entry.name, arguments: entry.args },
      }))

    const response = {
      content: state.content,
      reasoning: state.reasoning,
      toolCalls: aggregatedToolCalls,
      usage: state.usage,
      finishReason: state.finishReason,
    }

    if (providerSupports(provider, 'cache_breakpoint')) {
      await recordQueryCacheUsage(response.usage, stablePrefix, provider)
    }

    yield deepSeekResponseToAssistantMessage(response, {
      messageId,
      model: runtimeModel ?? 'deepseek-v4-pro',
      provider,
      now,
      uuid,
    })
  }
}

export function createProviderStreamContext({
  provider,
  systemPrompt,
  messages,
  tools,
  toolSchemaOptions,
  stablePrefix,
  env,
  cwd,
  model,
  reasoningEffort,
  maxTokens,
  toolChoice,
  signal,
  fetch,
}) {
  return omitUndefined({
    systemPrompt,
    messages,
    tools,
    toolSchemaOptions,
    stablePrefix: providerSupports(provider, 'stable_prefix_cache')
      ? stablePrefix
      : undefined,
    env,
    cwd,
    model,
    reasoningEffort: providerSupports(provider, 'reasoning_effort')
      ? reasoningEffort
      : undefined,
    maxTokens,
    toolChoice,
    signal,
    fetch,
  })
}

function createStreamingState() {
  return {
    blockIndex: 0,
    thinkingOpen: false,
    textOpen: false,
    openToolBlockIndices: new Set(),
    toolCalls: new Map(),
    content: '',
    reasoning: '',
    usage: null,
    finishReason: null,
  }
}

function* closeThinkingIfOpen(state) {
  if (state.thinkingOpen) {
    yield streamEvent({
      type: 'content_block_stop',
      index: state.blockIndex,
    })
    state.thinkingOpen = false
    state.blockIndex += 1
  }
}

function* closeOpenInlineBlocks(state) {
  yield* closeThinkingIfOpen(state)
  if (state.textOpen) {
    yield streamEvent({
      type: 'content_block_stop',
      index: state.blockIndex,
    })
    state.textOpen = false
    state.blockIndex += 1
  }
}

function* closeAllOpenBlocks(state) {
  yield* closeOpenInlineBlocks(state)
  for (const toolBlockIndex of [...state.openToolBlockIndices].sort((a, b) => a - b)) {
    yield streamEvent({
      type: 'content_block_stop',
      index: toolBlockIndex,
    })
  }
  state.openToolBlockIndices.clear()
}

function streamEvent(event) {
  return { type: 'stream_event', event }
}

async function recordQueryCacheUsage(usage, stablePrefix, provider) {
  if (!usage) return
  const config = resolveDeepSeekConfig({
    env: process.env,
    cwd: process.cwd(),
  })
  const path = resolveDeepSeekCacheStatsPath({
    env: process.env,
    config,
    provider,
  })
  await recordDeepSeekCacheUsage({
    path,
    usage,
    provider,
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
  {
    messageId,
    model = 'deepseek-v4-pro',
    provider,
    now = () => new Date(),
    uuid = randomUUID,
  } = {},
) {
  const id = messageId ?? `msg_deepseek_${uuid()}`
  const content = []

  if (response.reasoning) {
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
      id,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: mapStopReasonForClaudeCode(finish.finishReason),
      stop_sequence: null,
      usage: mapUsageForClaudeCode(response.usage, { provider }),
    },
  }
}

function mapStopReasonForClaudeCode(finishReason) {
  if (finishReason === 'tool_calls') return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  if (!finishReason || finishReason === 'unknown') return null
  return finishReason
}

function mapUsageForClaudeCode(usage = {}, { provider } = {}) {
  usage ??= {}
  const supportsCache = providerSupports(provider, 'cache_breakpoint')
  const cacheHit = supportsCache ? usage.prompt_cache_hit_tokens ?? 0 : 0
  const cacheMiss = supportsCache ? usage.prompt_cache_miss_tokens ?? 0 : 0
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

function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}
