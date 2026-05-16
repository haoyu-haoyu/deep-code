import { randomUUID } from 'node:crypto'

import {
  createDeepSeekProvider,
  DEFAULT_DEEPSEEK_SMALL_MODEL,
} from '../providers/deepseek.mjs'
import {
  RuntimeAbortError,
  RuntimeRequestError,
  toRuntimeError,
} from './errors.js'
import {
  EMPTY_USAGE,
  type NonNullableUsage,
  updateUsage,
} from './usage.js'

export {
  formatRuntimeErrorForUser,
  isRuntimeAbortError,
  isRuntimeRequestError,
  RuntimeAbortError,
  RuntimeRequestError,
} from './errors.js'

export type RuntimeRole = 'user' | 'assistant' | 'system'

export type RuntimeMessage = {
  role: RuntimeRole
  content: string | RuntimeContentBlock[]
}

export type RuntimeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }

export type RuntimeTool = {
  name: string
  description: string
  input_schema: unknown
}

export type RuntimeToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }

export type RuntimeStreamEvent =
  | {
      type: 'message_start'
      message: {
        id: string
        role: 'assistant'
        model: string
        usage: NonNullableUsage
      }
    }
  | {
      type: 'content_block_start'
      index: number
      contentBlock:
        | { type: 'text'; text: string }
        | { type: 'thinking'; thinking: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
    }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'input_json_delta'; partial_json: string }
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'tool_use_delta'
      index: number
      id: string
      name: string
      partialJson: string
    }
  | {
      type: 'message_delta'
      stopReason: string
      usage: NonNullableUsage
    }
  | { type: 'message_stop' }

export type RuntimeAssistantMessage = {
  role: 'assistant'
  content: RuntimeContentBlock[]
  usage: NonNullableUsage
  stopReason: string
}

export type RuntimeMessageOptions = {
  systemPrompt: string[]
  messages: ReadonlyArray<RuntimeMessage>
  maxThinkingTokens: number
  tools: ReadonlyArray<RuntimeTool>
  signal?: AbortSignal
  model: string
  smallModel?: string
  toolChoice?: RuntimeToolChoice
  prependCLISysprompt?: boolean
}

type DeepSeekProviderEvent =
  | { type: 'reasoning_delta'; text?: unknown }
  | { type: 'content_delta'; text?: unknown }
  | {
      type: 'tool_call_delta'
      index?: unknown
      id?: unknown
      name?: unknown
      argumentsDelta?: unknown
      finishReason?: unknown
    }
  | { type: 'finish'; finishReason?: unknown }
  | { type: 'usage'; usage?: unknown }
  | { type: 'done' }

type RuntimeResponseState = {
  content: RuntimeContentBlock[]
  text: string
  usage: NonNullableUsage
  stopReason: string
  blockIndex: number
  textOpen: boolean
  thinkingOpen: boolean
  toolCalls: Map<number, RuntimeToolCallState>
}

type RuntimeToolCallState = {
  blockIndex: number
  id: string
  name: string
  partialJson: string
}

export async function* queryRuntimeWithStreaming(
  opts: RuntimeMessageOptions,
): AsyncGenerator<RuntimeStreamEvent, void, void> {
  assertNotAborted(opts.signal)

  const model = opts.model
  const state = createResponseState()
  yield {
    type: 'message_start',
    message: {
      id: `msg_runtime_${randomUUID()}`,
      role: 'assistant',
      model,
      usage: EMPTY_USAGE,
    },
  }

  try {
    for await (const event of streamProviderEvents(opts)) {
      assertNotAborted(opts.signal)
      yield* applyProviderEventToStream(state, event)
    }

    yield* closeOpenBlocks(state)
    yield {
      type: 'message_delta',
      stopReason: state.stopReason,
      usage: state.usage,
    }
    yield { type: 'message_stop' }
  } catch (error) {
    throw normalizeRuntimeError(error, opts.signal)
  }
}

export async function queryRuntimeWithoutStreaming(
  opts: RuntimeMessageOptions,
): Promise<RuntimeAssistantMessage> {
  assertNotAborted(opts.signal)
  const state = createResponseState()

  try {
    for await (const event of streamProviderEvents(opts)) {
      assertNotAborted(opts.signal)
      applyProviderEventToState(state, event)
    }
    flushTextContent(state)
    flushToolContent(state)
    return {
      role: 'assistant',
      content: state.content,
      usage: state.usage,
      stopReason: state.stopReason,
    }
  } catch (error) {
    throw normalizeRuntimeError(error, opts.signal)
  }
}

export async function queryRuntimeSmall(opts: {
  systemPrompt: string[]
  userPrompt: string
  model?: string
  signal?: AbortSignal
}): Promise<RuntimeAssistantMessage> {
  return await queryRuntimeWithoutStreaming({
    systemPrompt: opts.systemPrompt,
    messages: [{ role: 'user', content: opts.userPrompt }],
    maxThinkingTokens: 0,
    tools: [],
    signal: opts.signal,
    model: opts.model ?? DEFAULT_DEEPSEEK_SMALL_MODEL,
  })
}

export function queryRuntimeWithModel(
  opts: RuntimeMessageOptions & { modelOverride: string },
): AsyncGenerator<RuntimeStreamEvent, void, void> {
  return queryRuntimeWithStreaming({
    ...opts,
    model: opts.modelOverride,
  })
}

async function* streamProviderEvents(
  opts: RuntimeMessageOptions,
): AsyncGenerator<DeepSeekProviderEvent, void, void> {
  const provider = createDeepSeekProvider()
  yield* provider.streamQuery({
    systemPrompt: opts.systemPrompt,
    messages: opts.messages,
    tools: opts.tools,
    model: opts.model,
    thinking: opts.maxThinkingTokens > 0 ? 'enabled' : 'disabled',
    toolChoice: mapToolChoice(opts.toolChoice),
    signal: opts.signal,
  })
}

function* applyProviderEventToStream(
  state: RuntimeResponseState,
  event: DeepSeekProviderEvent,
): Generator<RuntimeStreamEvent, void, void> {
  if (event.type === 'reasoning_delta' && typeof event.text === 'string') {
    if (!state.thinkingOpen) {
      yield* closeTextIfOpen(state)
      yield {
        type: 'content_block_start',
        index: state.blockIndex,
        contentBlock: { type: 'thinking', thinking: '' },
      }
      state.thinkingOpen = true
    }
    yield {
      type: 'content_block_delta',
      index: state.blockIndex,
      delta: { type: 'thinking_delta', thinking: event.text },
    }
    return
  }

  if (event.type === 'content_delta' && typeof event.text === 'string') {
    state.text += event.text
    yield* closeThinkingIfOpen(state)
    if (!state.textOpen) {
      yield {
        type: 'content_block_start',
        index: state.blockIndex,
        contentBlock: { type: 'text', text: '' },
      }
      state.textOpen = true
    }
    yield {
      type: 'content_block_delta',
      index: state.blockIndex,
      delta: { type: 'text_delta', text: event.text },
    }
    return
  }

  if (event.type === 'tool_call_delta') {
    const index = readIndex(event.index)
    const isNewToolBlock = !state.toolCalls.has(index)
    yield* closeInlineBlocksBeforeTool(state)
    const tool = getToolState(state, event)
    if (isNewToolBlock) {
      yield {
        type: 'content_block_start',
        index: tool.blockIndex,
        contentBlock: {
          type: 'tool_use',
          id: tool.id,
          name: tool.name,
          input: {},
        },
      }
    }
    yield {
      type: 'tool_use_delta',
      index,
      id: tool.id,
      name: tool.name,
      partialJson:
        typeof event.argumentsDelta === 'string' ? event.argumentsDelta : '',
    }
    if (typeof event.argumentsDelta === 'string') {
      yield {
        type: 'content_block_delta',
        index: tool.blockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: event.argumentsDelta,
        },
      }
    }
    return
  }

  if (event.type === 'finish') {
    state.stopReason =
      typeof event.finishReason === 'string' ? event.finishReason : 'stop'
    return
  }

  if (event.type === 'usage') {
    state.usage = updateUsage(state.usage, event.usage)
  }
}

function applyProviderEventToState(
  state: RuntimeResponseState,
  event: DeepSeekProviderEvent,
): void {
  if (event.type === 'content_delta' && typeof event.text === 'string') {
    state.text += event.text
  } else if (event.type === 'tool_call_delta') {
    getToolState(state, event)
  } else if (event.type === 'finish') {
    state.stopReason =
      typeof event.finishReason === 'string' ? event.finishReason : 'stop'
  } else if (event.type === 'usage') {
    state.usage = updateUsage(state.usage, event.usage)
  }
}

function createResponseState(): RuntimeResponseState {
  return {
    content: [],
    text: '',
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    blockIndex: 0,
    textOpen: false,
    thinkingOpen: false,
    toolCalls: new Map(),
  }
}

function getToolState(
  state: RuntimeResponseState,
  event: Extract<DeepSeekProviderEvent, { type: 'tool_call_delta' }>,
): RuntimeToolCallState {
  const index = readIndex(event.index)
  let tool = state.toolCalls.get(index)
  if (!tool) {
    tool = {
      blockIndex: state.blockIndex,
      id:
        typeof event.id === 'string'
          ? event.id
          : `toolu_runtime_${randomUUID()}`,
      name: typeof event.name === 'string' ? event.name : '',
      partialJson: '',
    }
    state.toolCalls.set(index, tool)
    state.blockIndex += 1
  }
  if (typeof event.id === 'string') tool.id = event.id
  if (typeof event.name === 'string') tool.name = event.name
  if (typeof event.argumentsDelta === 'string') {
    tool.partialJson += event.argumentsDelta
  }
  if (typeof event.finishReason === 'string') {
    state.stopReason = event.finishReason
  }
  return tool
}

function flushTextContent(state: RuntimeResponseState): void {
  if (state.text) {
    state.content.push({ type: 'text', text: state.text })
    state.text = ''
  }
}

function flushToolContent(state: RuntimeResponseState): void {
  for (const [, tool] of [...state.toolCalls.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    state.content.push({
      type: 'tool_use',
      id: tool.id,
      name: tool.name,
      input: parseToolInput(tool.partialJson),
    })
  }
}

function* closeOpenBlocks(
  state: RuntimeResponseState,
): Generator<RuntimeStreamEvent, void, void> {
  yield* closeThinkingIfOpen(state)
  yield* closeTextIfOpen(state)
  for (const [, tool] of [...state.toolCalls.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    yield { type: 'content_block_stop', index: tool.blockIndex }
  }
}

function* closeInlineBlocksBeforeTool(
  state: RuntimeResponseState,
): Generator<RuntimeStreamEvent, void, void> {
  yield* closeThinkingIfOpen(state)
  yield* closeTextIfOpen(state)
}

function* closeThinkingIfOpen(
  state: RuntimeResponseState,
): Generator<RuntimeStreamEvent, void, void> {
  if (!state.thinkingOpen) return
  yield { type: 'content_block_stop', index: state.blockIndex }
  state.thinkingOpen = false
  state.blockIndex += 1
}

function* closeTextIfOpen(
  state: RuntimeResponseState,
): Generator<RuntimeStreamEvent, void, void> {
  if (!state.textOpen) return
  yield { type: 'content_block_stop', index: state.blockIndex }
  state.textOpen = false
  state.blockIndex += 1
}

function readIndex(index: unknown): number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0
    ? index
    : 0
}

function parseToolInput(partialJson: string): unknown {
  if (!partialJson) return {}
  try {
    return JSON.parse(partialJson)
  } catch {
    return { _raw: partialJson }
  }
}

function mapToolChoice(
  toolChoice: RuntimeToolChoice | undefined,
): unknown | undefined {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'any') return 'required'
  return { type: 'function', function: { name: toolChoice.name } }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RuntimeAbortError()
  }
}

function normalizeRuntimeError(
  error: unknown,
  signal: AbortSignal | undefined,
): RuntimeRequestError | RuntimeAbortError {
  if (signal?.aborted || error instanceof RuntimeAbortError) {
    return new RuntimeAbortError()
  }
  return toRuntimeError(error)
}

// Re-export DeepSeek-native callModel adapter as the runtime entry point
// for query.ts main hot path consumers via query/deps.ts. The DeepSeek
// adapter already encapsulates stable-prefix hashing, cache telemetry, and
// streaming-event normalization; runtime layer just shims it.
// @ts-expect-error DeepSeek call-model adapter is JS; query/deps.ts uses
// ReturnType<> for typing instead of a .d.ts.
export { createDeepSeekCallModel as createRuntimeCallModel } from '../../query/deepseek-call-model.mjs'
