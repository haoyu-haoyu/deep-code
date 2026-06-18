import { randomUUID } from 'node:crypto'

import {
  createDeepSeekStreamError,
  DEFAULT_DEEPSEEK_SMALL_MODEL,
  resolveDeepSeekConfig,
} from '../providers/deepseek.mjs'
import { resolveProviderConfig } from '../providers/provider-config.mjs'
import { resolveToolCallIndex } from '../toolCallIndex.mjs'
import { resolveModelProvider } from '../providers/registry.mjs'
import {
  isDeepSeekProvider,
  resolveRuntimeModelProvider,
} from '../providers/runtime-provider.mjs'
import { routeTurn, type AutoRouteDecision } from '../autoMode/router.js'
import {
  extractLatestUserMessage,
  getMemoizedRoute,
  setMemoizedRoute,
} from '../autoMode/routeMemo.mjs'
import { providerSupports } from '../../deepcode/provider-capabilities.mjs'
import { stableJsonStringifySafe } from '../../cache/deepseek-cache.mjs'
// @ts-expect-error DeepSeek call-model adapter is JS; runtime native primitives use it
// internally for non-streaming collection. Exposed externally via the
// local re-export at the bottom of this file.
import { createDeepSeekCallModel } from '../../query/deepseek-call-model.mjs'
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
// AssistantMessage type is required for native primitives' return type so
// utility callers can consume the runtime result without casting. The
// types/message layer is project-neutral, not part of services/api/*.
import type { AssistantMessage } from '../../types/message.js'

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
        autoRouteDecision?: AutoRouteDecision
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

const AUTO_MODEL_SETTING = 'auto'
const DEFAULT_AUTO_PRO_MODEL = 'deepseek-v4-pro'

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
  | { type: 'error'; error?: unknown }

type RuntimeResponseState = {
  content: RuntimeContentBlock[]
  text: string
  usage: NonNullableUsage
  stopReason: string
  blockIndex: number
  textOpen: boolean
  thinkingOpen: boolean
  toolCalls: Map<number, RuntimeToolCallState>
  provider?: RuntimeModelProvider
}

type RuntimeToolCallState = {
  blockIndex: number
  id: string
  name: string
  partialJson: string
}

type ResolvedRuntimeRoute = {
  model: string
  thinking: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh'
  autoRouteDecision?: AutoRouteDecision
}

type RuntimeModelProvider = {
  name?: string
  supports?: (capability: string) => boolean
  streamQuery(context?: Record<string, unknown>): AsyncIterable<DeepSeekProviderEvent>
}

export async function* queryRuntimeWithStreaming(
  opts: RuntimeMessageOptions,
): AsyncGenerator<RuntimeStreamEvent, void, void> {
  assertNotAborted(opts.signal)

  const route = await resolveRuntimeRoute(opts)
  const model = route.model
  const provider = createRuntimeProvider()
  const state = createResponseState(provider)
  yield {
    type: 'message_start',
    message: {
      id: `msg_runtime_${randomUUID()}`,
      role: 'assistant',
      model,
      ...(route.autoRouteDecision
        ? { autoRouteDecision: route.autoRouteDecision }
        : {}),
      usage: EMPTY_USAGE,
    },
  }

  try {
    for await (const event of streamProviderEvents(opts, route, provider)) {
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
  const route = await resolveRuntimeRoute(opts)
  const provider = createRuntimeProvider()
  const state = createResponseState(provider)

  try {
    for await (const event of streamProviderEvents(opts, route, provider)) {
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

async function resolveRuntimeRoute(
  opts: RuntimeMessageOptions,
): Promise<ResolvedRuntimeRoute> {
  return await resolveAutoRoute({
    model: opts.model,
    messages: opts.messages,
    signal: opts.signal,
    maxThinkingTokens: opts.maxThinkingTokens,
  })
}

async function resolveAutoRoute({
  model,
  messages,
  signal,
  maxThinkingTokens,
}: {
  model: string
  messages: ReadonlyArray<unknown>
  signal?: AbortSignal
  maxThinkingTokens: number
}): Promise<ResolvedRuntimeRoute> {
  if (!isAutoModelSetting(model)) {
    return {
      model,
      thinking: maxThinkingTokens > 0 ? 'enabled' : 'disabled',
    }
  }

  // The auto-route is "valid for the whole task". Memoize the classifier DECISION
  // per task (keyed on the latest human user message — the exact thing routeTurn
  // classifies on) so tool-loop continuations REUSE it instead of re-running the
  // ~80-token classifier and possibly flipping the model mid-task, which would
  // cold-reset the prefix cache. We cache the decision, NOT the resolved runtime
  // route: the cheap, deterministic decision->model mapping below runs every turn,
  // so a mid-session model-config change is reflected immediately, while the
  // expensive classification stays cached and the model field stays stable across
  // the task (config unchanged -> same decision -> same model).
  const normalized = normalizeMessagesForAutoRouter(messages)
  const taskKey = extractLatestUserMessage(normalized)
  let decision = getMemoizedRoute(taskKey) as AutoRouteDecision | null
  if (!decision) {
    decision = await routeTurn(
      normalized,
      signal ?? new AbortController().signal,
    )
    setMemoizedRoute(taskKey, decision)
  }
  return routeDecisionToRuntime(decision)
}

function routeDecisionToRuntime(
  decision: AutoRouteDecision,
): ResolvedRuntimeRoute {
  const thinking =
    decision.thinking === 'off' ? 'disabled' : ('enabled' as const)
  const config = resolveDeepSeekConfig()
  const mainModel =
    typeof config.model === 'string' && !isAutoModelSetting(config.model)
      ? config.model
      : DEFAULT_AUTO_PRO_MODEL
  const smallModel =
    typeof config.smallModel === 'string' &&
    !isAutoModelSetting(config.smallModel)
      ? config.smallModel
      : DEFAULT_DEEPSEEK_SMALL_MODEL
  return {
    model: decision.model === 'flash' ? smallModel : mainModel,
    thinking,
    reasoningEffort:
      decision.thinking === 'off' ? undefined : decision.thinking,
    autoRouteDecision: decision,
  }
}

async function* streamProviderEvents(
  opts: RuntimeMessageOptions,
  route: ResolvedRuntimeRoute,
  provider: RuntimeModelProvider,
): AsyncGenerator<DeepSeekProviderEvent, void, void> {
  yield* provider.streamQuery({
    systemPrompt: opts.systemPrompt,
    messages: opts.messages,
    tools: opts.tools,
    model: route.model,
    thinking: providerSupports(provider, 'extended_thinking')
      ? route.thinking
      : undefined,
    reasoningEffort: providerSupports(provider, 'reasoning_effort')
      ? route.reasoningEffort
      : undefined,
    toolChoice: mapToolChoice(opts.toolChoice),
    signal: opts.signal,
  })
}

function* applyProviderEventToStream(
  state: RuntimeResponseState,
  event: DeepSeekProviderEvent,
): Generator<RuntimeStreamEvent, void, void> {
  // A mid-stream server error unwinds the turn rather than committing the
  // partial text as a successful response.
  if (event.type === 'error') {
    throw createDeepSeekStreamError(event.error)
  }
  if (event.type === 'reasoning_delta' && typeof event.text === 'string') {
    if (!providerSupports(state.provider, 'reasoning_content')) return
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
    const index = resolveToolCallIndex(state.toolCalls, event)
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
    state.usage = updateUsage(state.usage, event.usage, {
      provider: state.provider,
    })
  }
}

function applyProviderEventToState(
  state: RuntimeResponseState,
  event: DeepSeekProviderEvent,
): void {
  if (event.type === 'error') {
    throw createDeepSeekStreamError(event.error)
  }
  if (event.type === 'content_delta' && typeof event.text === 'string') {
    state.text += event.text
  } else if (event.type === 'tool_call_delta') {
    getToolState(state, event)
  } else if (event.type === 'finish') {
    state.stopReason =
      typeof event.finishReason === 'string' ? event.finishReason : 'stop'
  } else if (event.type === 'usage') {
    state.usage = updateUsage(state.usage, event.usage, {
      provider: state.provider,
    })
  }
}

function createResponseState(provider?: RuntimeModelProvider): RuntimeResponseState {
  return {
    content: [],
    text: '',
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    blockIndex: 0,
    textOpen: false,
    thinkingOpen: false,
    toolCalls: new Map(),
    provider,
  }
}

function getToolState(
  state: RuntimeResponseState,
  event: Extract<DeepSeekProviderEvent, { type: 'tool_call_delta' }>,
): RuntimeToolCallState {
  const index = resolveToolCallIndex(state.toolCalls, event)
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

function normalizeMessagesForAutoRouter(
  messages: ReadonlyArray<unknown>,
): RuntimeMessage[] {
  return messages
    .map(message => {
      const role = readMessageRole(message)
      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        return undefined
      }
      const content = readMessageContent(message)
      return { role, content: contentToRouterContent(content) }
    })
    .filter((message): message is RuntimeMessage => message !== undefined)
}

function readMessageRole(message: unknown): unknown {
  if (!isRecord(message)) return undefined
  const nested = isRecord(message.message) ? message.message : undefined
  return message.role ?? nested?.role ?? message.type
}

function readMessageContent(message: unknown): unknown {
  if (!isRecord(message)) return ''
  const nested = isRecord(message.message) ? message.message : undefined
  return message.content ?? nested?.content ?? ''
}

function contentToRouterContent(content: unknown): string | RuntimeContentBlock[] {
  if (typeof content === 'string' || Array.isArray(content)) {
    return content as string | RuntimeContentBlock[]
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isAutoModelSetting(model: unknown): model is typeof AUTO_MODEL_SETTING {
  return (
    typeof model === 'string' &&
    model.trim().toLowerCase() === AUTO_MODEL_SETTING
  )
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

/**
 * Internal helper: consume a DeepSeek streaming callModel async generator
 * and return the final AssistantMessage. Used by non-streaming runtime
 * primitives.
 */
async function collectFinalAssistantFromCallModel(args: {
  messages: ReadonlyArray<unknown>
  systemPrompt: unknown
  thinkingConfig: unknown
  tools: ReadonlyArray<unknown>
  signal: AbortSignal
  options: Record<string, unknown>
}): Promise<AssistantMessage> {
  const callModel = createDeepSeekCallModel()
  let lastAssistant: AssistantMessage | undefined
  try {
    for await (const message of callModel(args)) {
      if ((message as { type?: string })?.type === 'assistant') {
        lastAssistant = message as AssistantMessage
      }
    }
  } catch (error) {
    if (args.signal.aborted && !lastAssistant) {
      throw new RuntimeAbortError('Runtime non-streaming request aborted')
    }
    throw error
  }
  if (!lastAssistant) {
    if (args.signal.aborted) {
      throw new RuntimeAbortError('Runtime non-streaming request aborted')
    }
    throw new RuntimeRequestError('Runtime produced no assistant message')
  }
  return lastAssistant
}

/**
 * Native DeepSeek non-streaming message helper. Input shape mirrors the
 * legacy non-streaming helper so caller migration can be mechanical.
 */
export async function queryRuntimeModelWithoutStreaming(args: {
  messages: ReadonlyArray<unknown>
  systemPrompt: unknown
  thinkingConfig: unknown
  tools: ReadonlyArray<unknown>
  signal: AbortSignal
  options: Record<string, unknown>
}): Promise<AssistantMessage> {
  return collectFinalAssistantFromCallModel(args)
}

/**
 * Native DeepSeek small-model helper. If outputFormat is provided, it is
 * appended to the system prompt as a best-effort JSON schema hint.
 */
export async function queryRuntimeHaiku(args: {
  systemPrompt: ReadonlyArray<string>
  userPrompt: string
  outputFormat?: unknown
  signal: AbortSignal
  options: Record<string, unknown>
}): Promise<AssistantMessage> {
  const baseSystemPrompt = Array.isArray(args.systemPrompt)
    ? Array.from(args.systemPrompt)
    : []
  const effectiveSystemPrompt = args.outputFormat
    ? [
        ...baseSystemPrompt,
        `Respond with JSON conforming to this schema: ${stableJsonStringifySafe(args.outputFormat)}`,
      ]
    : baseSystemPrompt

  const userMessage = {
    type: 'user' as const,
    message: { role: 'user' as const, content: args.userPrompt },
    uuid: '00000000-0000-0000-0000-000000000000',
  }

  return collectFinalAssistantFromCallModel({
    messages: [userMessage],
    systemPrompt: effectiveSystemPrompt,
    thinkingConfig: { type: 'disabled' as const },
    tools: [],
    signal: args.signal,
    options: {
      ...args.options,
      model:
        (args.options.model as string | undefined) ?? DEFAULT_DEEPSEEK_SMALL_MODEL,
    },
  })
}

/**
 * Native DeepSeek non-streaming helper with explicit model selection.
 * Provider-neutral equivalent of services/api/claude.queryWithModel:
 * same shape as queryRuntimeHaiku but options.model is required (no
 * DEFAULT_DEEPSEEK_SMALL_MODEL fallback).
 *
 * Used by F.a3.2 callers (commands/insights.ts) that drive analysis with
 * a specific non-small model.
 */
export async function queryRuntimeWithModelNonStreaming(args: {
  systemPrompt: ReadonlyArray<string>
  userPrompt: string
  outputFormat?: unknown
  signal: AbortSignal
  options: Record<string, unknown> & { model: string }
}): Promise<AssistantMessage> {
  if (typeof args.options.model !== 'string' || !args.options.model) {
    throw new RuntimeRequestError(
      'queryRuntimeWithModelNonStreaming requires options.model',
    )
  }
  const baseSystemPrompt = Array.isArray(args.systemPrompt)
    ? Array.from(args.systemPrompt)
    : []
  const effectiveSystemPrompt = args.outputFormat
    ? [
        ...baseSystemPrompt,
        `Respond with JSON conforming to this schema: ${stableJsonStringifySafe(args.outputFormat)}`,
      ]
    : baseSystemPrompt

  const userMessage = {
    type: 'user' as const,
    message: { role: 'user' as const, content: args.userPrompt },
    uuid: '00000000-0000-0000-0000-000000000000',
  }

  return collectFinalAssistantFromCallModel({
    messages: [userMessage],
    systemPrompt: effectiveSystemPrompt,
    thinkingConfig: { type: 'disabled' as const },
    tools: [],
    signal: args.signal,
    options: args.options,
  })
}

/**
 * Native DeepSeek streaming helper. One-step entry point that calls
 * createDeepSeekCallModel() and returns its async generator. Provider-neutral
 * equivalent of services/api/claude.queryModelWithStreaming for callers that
 * consume the call-model stream directly (currently F.a4 WebSearchTool).
 *
 * Stream event shape matches what createDeepSeekCallModel yields:
 * { type: 'stream_event', event: {...} } interleaved with the final
 * { type: 'assistant', ...AssistantMessage } yield.
 */
export function queryRuntimeModelWithStreaming(args: {
  messages: ReadonlyArray<unknown>
  systemPrompt: unknown
  thinkingConfig: unknown
  tools: ReadonlyArray<unknown>
  signal: AbortSignal
  options: Record<string, unknown>
}): ReturnType<ReturnType<typeof createDeepSeekCallModel>> {
  const callModel = createRuntimeCallModel()
  return callModel(args) as ReturnType<ReturnType<typeof createDeepSeekCallModel>>
}

type RuntimeCallModelFactoryOptions = {
  provider?: {
    supports?: (capability: string) => boolean
    streamQuery(context?: Record<string, unknown>): AsyncIterable<unknown>
  }
  now?: () => Date
  uuid?: () => string
}

type RuntimeCallModelArgs = {
  messages?: ReadonlyArray<unknown>
  systemPrompt?: unknown
  tools?: ReadonlyArray<unknown>
  signal?: AbortSignal
  options?: Record<string, unknown>
}

export function createRuntimeCallModel(
  options: RuntimeCallModelFactoryOptions = {},
): ReturnType<typeof createDeepSeekCallModel> {
  // Resolve the configured provider ONCE so the default call model and the
  // auto-route gate agree. With nothing configured this is the byte-identical
  // DeepSeek provider; an explicit non-deepseek provider switches the runtime.
  const provider = options.provider ?? resolveRuntimeModelProvider()
  const resolvedOptions = { ...options, provider }
  const defaultCallModel = createDeepSeekCallModel(resolvedOptions)

  return (async function* queryDeepSeekModelWithStreaming(
    callArgs: RuntimeCallModelArgs = {},
  ): AsyncGenerator<unknown, void, void> {
    const callOptions = isRecord(callArgs.options) ? callArgs.options : {}
    // 'auto' routing is DeepSeek-specific (it routes among deepseek models). For
    // a non-DeepSeek configured provider, treat 'auto' as a normal request to
    // that provider (its default model) rather than silently rerouting the
    // user's data to DeepSeek.
    if (!isAutoModelSetting(callOptions.model) || !isDeepSeekProvider(provider)) {
      yield* defaultCallModel(callArgs)
      return
    }

    const route = await resolveAutoRoute({
      model: AUTO_MODEL_SETTING,
      messages: callArgs.messages ?? [],
      signal: callArgs.signal,
      maxThinkingTokens: 0,
    })
    const callModel = createDeepSeekCallModel({
      ...resolvedOptions,
      provider: createAutoRouteProvider(provider, route),
    })
    const routedArgs = {
      ...callArgs,
      options: {
        ...callOptions,
        model: route.model,
        effortValue: route.reasoningEffort,
      },
    }

    for await (const message of callModel(routedArgs)) {
      yield attachAutoRouteDecision(message, route.autoRouteDecision)
    }
  }) as ReturnType<typeof createDeepSeekCallModel>
}

function createAutoRouteProvider(
  provider: RuntimeCallModelFactoryOptions['provider'],
  route: ResolvedRuntimeRoute,
): RuntimeCallModelFactoryOptions['provider'] {
  const baseProvider = provider ?? resolveRuntimeModelProvider()
  return {
    ...baseProvider,
    streamQuery(context: Record<string, unknown> = {}) {
      return baseProvider.streamQuery({
        ...context,
        thinking: providerSupports(baseProvider, 'extended_thinking')
          ? route.thinking
          : undefined,
        reasoningEffort: providerSupports(baseProvider, 'reasoning_effort')
          ? route.reasoningEffort
          : undefined,
      })
    },
  }
}

function createRuntimeProvider(): RuntimeModelProvider {
  const config = resolveProviderConfig({ env: process.env })
  return resolveModelProvider({
    env: process.env,
    name: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    defaults: {
      env: process.env,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.defaultModel,
    },
  }) as RuntimeModelProvider
}

function attachAutoRouteDecision(
  message: unknown,
  decision: AutoRouteDecision | undefined,
): unknown {
  if (!decision || !isRecord(message) || message.type !== 'stream_event') {
    return message
  }
  const event = message.event
  if (!isRecord(event) || event.type !== 'message_start') {
    return message
  }
  const eventMessage = event.message
  if (!isRecord(eventMessage)) {
    return message
  }
  return {
    ...message,
    event: {
      ...event,
      message: {
        ...eventMessage,
        autoRouteDecision: decision,
      },
    },
  }
}
