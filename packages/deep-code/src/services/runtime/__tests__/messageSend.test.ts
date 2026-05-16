import { beforeEach, expect, mock, test } from 'bun:test'

type ProviderEvent =
  | { type: 'reasoning_delta'; text: string }
  | { type: 'content_delta'; text: string }
  | {
      type: 'tool_call_delta'
      index?: number
      id?: string
      name?: string
      argumentsDelta?: string
      finishReason?: string
    }
  | { type: 'finish'; finishReason?: string }
  | { type: 'usage'; usage: Record<string, number> }

let providerEvents: ProviderEvent[] = []
let providerCalls: unknown[] = []

function createMockDeepSeekProvider() {
  return {
    async *streamQuery(context: unknown) {
      providerCalls.push(context)
      for (const event of providerEvents) {
        yield event
      }
    },
  }
}

mock.module('../../providers/deepseek.mjs', () => ({
  DEFAULT_DEEPSEEK_SMALL_MODEL: 'deepseek-v4-flash',
  createDeepSeekProvider: createMockDeepSeekProvider,
  resolveDeepSeekConfig() {
    return {
      model: 'deepseek-v4-pro',
      smallModel: 'deepseek-v4-flash',
    }
  },
}))

mock.module('../../../deepcode/deepseek-native.mjs', () => ({
  createDeepSeekProvider: createMockDeepSeekProvider,
  mapDeepSeekFinishReason(finishReason?: string) {
    return {
      finishReason: finishReason ?? 'stop',
      action: 'stop',
      retryable: false,
    }
  },
}))

const runtime = await import('../messageSend.ts')

beforeEach(() => {
  providerEvents = []
  providerCalls = []
})

test('queryRuntimeWithoutStreaming returns assistant content, stop reason, and usage', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'pong' },
    { type: 'finish', finishReason: 'stop' },
    {
      type: 'usage',
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        prompt_cache_hit_tokens: 3,
        prompt_cache_miss_tokens: 8,
      },
    },
  ]

  const message = await runtime.queryRuntimeWithoutStreaming({
    systemPrompt: ['You are Deep Code.'],
    messages: [{ role: 'user', content: 'ping' }],
    maxThinkingTokens: 0,
    tools: [],
    model: 'deepseek-v4-pro',
  })

  expect(message).toEqual({
    role: 'assistant',
    content: [{ type: 'text', text: 'pong' }],
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      cache_creation_input_tokens: 8,
      cache_read_input_tokens: 3,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard',
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
      inference_geo: '',
      iterations: [],
      speed: 'standard',
    },
    stopReason: 'stop',
  })
})

test('queryRuntimeWithStreaming yields reasoning, text, tool call, and stop events', async () => {
  providerEvents = [
    { type: 'reasoning_delta', text: 'thinking' },
    { type: 'content_delta', text: 'hello' },
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'toolu_1',
      name: 'Read',
      argumentsDelta: '{"file_path"',
    },
    {
      type: 'tool_call_delta',
      index: 0,
      argumentsDelta: ':"README.md"}',
      finishReason: 'tool_calls',
    },
    { type: 'finish', finishReason: 'tool_calls' },
    { type: 'usage', usage: { prompt_tokens: 5, completion_tokens: 4 } },
  ]

  const events = []
  for await (const event of runtime.queryRuntimeWithStreaming({
    systemPrompt: [],
    messages: [{ role: 'user', content: 'read' }],
    maxThinkingTokens: 1024,
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: { type: 'object' },
      },
    ],
    model: 'deepseek-v4-pro',
  })) {
    events.push(event)
  }

  expect(events.some(event => event.type === 'message_start')).toBe(true)
  expect(
    events.some(
      event =>
        event.type === 'content_block_delta' &&
        event.delta.type === 'thinking_delta',
    ),
  ).toBe(true)
  expect(
    events.some(
      event =>
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta',
    ),
  ).toBe(true)
  expect(
    events.some(
      event =>
        event.type === 'content_block_start' &&
        event.contentBlock.type === 'tool_use',
    ),
  ).toBe(true)
  expect(events.some(event => event.type === 'tool_use_delta')).toBe(true)
  expect(events.at(-1)).toEqual({ type: 'message_stop' })
})

test('queryRuntimeWithStreaming throws RuntimeAbortError for an aborted signal', async () => {
  const controller = new AbortController()
  controller.abort()

  try {
    for await (const _event of runtime.queryRuntimeWithStreaming({
      systemPrompt: [],
      messages: [{ role: 'user', content: 'ping' }],
      maxThinkingTokens: 0,
      tools: [],
      model: 'deepseek-v4-pro',
      signal: controller.signal,
    })) {
      throw new Error('unexpected event')
    }
    throw new Error('expected abort')
  } catch (error) {
    expect(runtime.isRuntimeAbortError(error)).toBe(true)
  }
})

test('queryRuntimeSmall uses the DeepSeek small model and returns an assistant message', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'short answer' },
    { type: 'finish', finishReason: 'stop' },
  ]

  const message = await runtime.queryRuntimeSmall({
    systemPrompt: ['Be concise.'],
    userPrompt: 'summarize',
  })

  expect(message.content).toEqual([{ type: 'text', text: 'short answer' }])
  expect(message.stopReason).toBe('stop')
  expect(providerCalls).toHaveLength(1)
  expect(providerCalls[0]).toMatchObject({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'summarize' }],
  })
})

test('isPromptTooLongMessage detects prompt-too-long error in assistant message', async () => {
  const errors = await import('../errors.ts')
  const { isPromptTooLongMessage, PROMPT_TOO_LONG_ERROR_MESSAGE } = errors

  expect(isPromptTooLongMessage(null)).toBe(false)
  expect(isPromptTooLongMessage(undefined)).toBe(false)
  expect(isPromptTooLongMessage({ type: 'user' })).toBe(false)
  expect(isPromptTooLongMessage({ type: 'assistant' })).toBe(false)
  expect(
    isPromptTooLongMessage({ type: 'assistant', isApiErrorMessage: true }),
  ).toBe(false)
  expect(
    isPromptTooLongMessage({
      type: 'assistant',
      isApiErrorMessage: true,
      message: { content: [{ type: 'text', text: 'unrelated error' }] },
    }),
  ).toBe(false)
  expect(
    isPromptTooLongMessage({
      type: 'assistant',
      isApiErrorMessage: true,
      message: {
        content: [
          {
            type: 'text',
            text: `${PROMPT_TOO_LONG_ERROR_MESSAGE}: context exceeded`,
          },
        ],
      },
    }),
  ).toBe(true)
})

test('createRuntimeCallModel re-export matches DeepSeek call-model factory shape', async () => {
  const runtime = await import('../messageSend.ts')
  expect(typeof runtime.createRuntimeCallModel).toBe('function')
  const callModel = runtime.createRuntimeCallModel()
  expect(typeof callModel).toBe('function')
})

test('categorizeRetryableAPIError classifies HTTP errors per SDK semantics', async () => {
  const errors = await import('../errors.ts')
  const { categorizeRetryableAPIError } = errors

  expect(categorizeRetryableAPIError(null)).toBe('unknown')
  expect(categorizeRetryableAPIError(undefined)).toBe('unknown')
  expect(categorizeRetryableAPIError({ status: 529 })).toBe('rate_limit')
  expect(
    categorizeRetryableAPIError({
      status: 500,
      message: '{"type":"overloaded_error","message":"server overloaded"}',
    }),
  ).toBe('rate_limit')
  expect(categorizeRetryableAPIError({ status: 429 })).toBe('rate_limit')
  expect(categorizeRetryableAPIError({ status: 401 })).toBe(
    'authentication_failed',
  )
  expect(categorizeRetryableAPIError({ status: 403 })).toBe(
    'authentication_failed',
  )
  expect(categorizeRetryableAPIError({ status: 500 })).toBe('server_error')
  expect(categorizeRetryableAPIError({ status: 502 })).toBe('server_error')
  expect(categorizeRetryableAPIError({ status: 408 })).toBe('server_error')
  expect(categorizeRetryableAPIError({ status: 400 })).toBe('unknown')
  expect(categorizeRetryableAPIError({ status: 200 })).toBe('unknown')
  expect(categorizeRetryableAPIError({})).toBe('unknown')
})
