import { randomUUID } from 'node:crypto'
import { mapDeepSeekFinishReason } from '../deepcode/deepseek-native.mjs'
import { resolveToolCallIndex } from '../services/toolCallIndex.mjs'
import { uncachedInputRemainder } from '../deepcode/usageInputRemainder.mjs'
import {
  isDeepSeekProvider,
  resolveRuntimeModelProvider,
} from '../services/providers/runtime-provider.mjs'
import { omitUndefined } from '../utils/omitUndefined.mjs'
import { isAutoModelSetting } from '../utils/model/autoModelSetting.mjs'
import {
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from '../deepcode/cache-telemetry.mjs'
import { recordTurn as recordDeepSeekCacheTurn } from '../cache/deepseek-cache.mjs'
import { providerSupports } from '../deepcode/provider-capabilities.mjs'
import { createDeepCodeStablePrefix } from '../deepcode/stable-prefix.mjs'
import { resolveDeepCodeRequestMaxTokens } from '../deepcode/context-policy.mjs'
import { coerceDeepSeekEffort } from '../services/providers/deepseekEffort.mjs'
import {
  createDeepSeekStreamError,
  resolveDeepSeekConfig,
} from '../services/providers/deepseek.mjs'

export function createDeepSeekCallModel({
  // Defaults to the config-resolved provider (DEEPCODE_PROVIDER / config file).
  // With nothing configured this returns the exact DeepSeek provider as before
  // — byte-identical request + cache moat — so existing behavior is unchanged;
  // an explicit non-deepseek provider switches the runtime to it.
  provider = resolveRuntimeModelProvider(),
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

    const runtimeModel = resolveDeepSeekRuntimeModel(options.model, { provider })
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

      // A mid-stream server error must unwind the turn, not be silently
      // dropped (which would commit the partial text as a successful end_turn).
      if (event.type === 'error') {
        throw createDeepSeekStreamError(event.error)
      }

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
        const toolIndex = resolveToolCallIndex(state.toolCalls, event)
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
      await recordQueryCacheUsage(response.usage, stablePrefix, provider, messageId, runtimeModel)
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

async function recordQueryCacheUsage(usage, stablePrefix, provider, turnId, model) {
  if (!usage) return
  if (!providerSupports(provider, 'cache_breakpoint')) return
  recordDeepSeekCacheTurn({
    turnId,
    hit: usage.prompt_cache_hit_tokens ?? 0,
    miss: usage.prompt_cache_miss_tokens ?? 0,
    prefixHash: stablePrefix?.prefixHash,
    componentHashes: stablePrefix?.componentHashes,
    model,
  })
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

export function resolveDeepSeekRuntimeModel(model, { provider } = {}) {
  const hasModel = typeof model === 'string' && model.length > 0

  // Non-DeepSeek provider: pass through ANY concrete model so the user can pick
  // e.g. gpt-4o / llama3.1:70b per request. 'auto' is DeepSeek-only routing
  // (gated upstream in createRuntimeCallModel) and must NOT leak through as a
  // literal model name — fall back to the provider's configured default
  // (undefined → buildRequest uses its resolvedDefaultModel).
  if (provider && !isDeepSeekProvider(provider)) {
    // isAutoModelSetting is case/whitespace-insensitive (matches the dropAuto
    // contract), so 'AUTO'/'Auto'/' auto ' can't leak as a literal model name.
    return hasModel && !isAutoModelSetting(model) ? model : undefined
  }

  // DeepSeek (and the no-provider default): only a deepseek-* model passes
  // through; otherwise the env-configured DeepSeek model. Never let a foreign
  // model name into a DeepSeek request — it would also mutate the stable prefix.
  if (hasModel && model.startsWith('deepseek')) {
    return model
  }
  // Drop a stray 'auto' from the env fallback too (DEEPSEEK_MODEL=auto is the
  // exact misconfig the guard neutralizes). Returning undefined keeps the common
  // path byte-identical — buildDeepSeekRequest substitutes the concrete default —
  // and stops the phantom 'auto' from reaching the runtimeModel metadata sinks
  // (message model display, cache-warmth record key, max-tokens model gate).
  const envModel = process.env.DEEPSEEK_MODEL ?? process.env.DEEPCODE_MODEL
  return isAutoModelSetting(envModel) ? undefined : envModel
}

export function resolveDeepSeekReasoningEffort(effortValue) {
  // Per-call pre-normalizer: preserve `undefined` for a nullish value so the
  // resolveDeepSeekConfig `??` chain can fall through, but pass the server's
  // graded enum (low/medium/high/max/xhigh) through faithfully otherwise.
  return coerceDeepSeekEffort(effortValue, { unset: undefined, fallback: 'high' })
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
    // input_tokens is the UNCACHED remainder, not the full prompt — otherwise
    // every consumer that sums input + cache_read + cache_creation double-counts
    // the cached prompt (~2x context). See usageInputRemainder.mjs.
    input_tokens:
      uncachedInputRemainder({
        promptTokens: usage.prompt_tokens,
        cacheRead: cacheHit,
        cacheCreation: cacheMiss,
      }) ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    // A SUBSET of output_tokens (DeepSeek bills reasoning inside completion_tokens),
    // surfaced beside it for the per-turn footer — never added to output_tokens.
    // mapDeepSeekUsage flattens it; tolerate the raw nested shape too.
    reasoning_tokens:
      usage.reasoning_tokens ??
      usage.completion_tokens_details?.reasoning_tokens ??
      0,
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
