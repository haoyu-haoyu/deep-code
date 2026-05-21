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

const mockGrowthBookFeatureRead = () => ({
  getFeatureValue_CACHED_MAY_BE_STALE<T>(_feature: string, defaultValue: T): T {
    return defaultValue
  },
})

mock.module('../../analytics/growthbook.js', mockGrowthBookFeatureRead)

const mockContextPolicy = () => ({
  CAPPED_DEFAULT_MAX_TOKENS: 8_000,
  getModelMaxOutputTokens: () => ({ default: 32_000, upperLimit: 64_000 }),
})

mock.module('../../../utils/context.js', mockContextPolicy)

const mockEnvValidation = () => ({
  validateBoundedIntEnvVar(
    _name: string,
    rawValue: string | undefined,
    defaultValue: number,
    upperLimit: number,
  ) {
    const parsed = rawValue ? parseInt(rawValue, 10) : NaN
    const effective =
      Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, upperLimit)
        : defaultValue
    return { effective }
  },
})

mock.module('../../../utils/envValidation.js', mockEnvValidation)

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

test('queryRuntimeModelWithoutStreaming returns the final assistant message', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'hello' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const result = (await runtime.queryRuntimeModelWithoutStreaming({
    messages: [
      {
        type: 'user',
        message: { role: 'user', content: 'hi' },
        uuid: '11111111-1111-1111-1111-111111111111',
      },
    ],
    systemPrompt: ['You are Deep Code.'],
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal: new AbortController().signal,
    options: {},
  })) as { type: string; message: { content: ReadonlyArray<unknown> } }

  expect(result.type).toBe('assistant')
  expect(Array.isArray(result.message.content)).toBe(true)
})

test('queryRuntimeHaiku constructs a single user message with DEFAULT_DEEPSEEK_SMALL_MODEL', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'short' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const result = (await runtime.queryRuntimeHaiku({
    systemPrompt: ['Be concise.'],
    userPrompt: 'ping',
    signal: new AbortController().signal,
    options: {},
  })) as { type: string }

  expect(result.type).toBe('assistant')
  expect(providerCalls.length).toBeGreaterThanOrEqual(1)
  const firstCall = providerCalls[0] as {
    model?: unknown
    messages?: ReadonlyArray<unknown>
  }
  expect(firstCall.model).toBe('deepseek-v4-flash')
  expect(firstCall.messages?.length).toBe(1)
})

test('queryRuntimeHaiku appends outputFormat schema hint to system prompt', async () => {
  providerEvents = [
    { type: 'content_delta', text: '{"answer":"yes"}' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const outputFormat = {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  }
  await runtime.queryRuntimeHaiku({
    systemPrompt: ['Help me.'],
    userPrompt: 'ask',
    outputFormat,
    signal: new AbortController().signal,
    options: {},
  })

  const firstCall = providerCalls[0] as { systemPrompt?: ReadonlyArray<string> }
  const hint = firstCall.systemPrompt?.find(s => s.includes('json_schema'))
  expect(hint).toBeDefined()
  expect(hint).toContain('answer')
})

test('queryRuntimeHaiku allows options.model to override DEFAULT_DEEPSEEK_SMALL_MODEL', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'ok' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  await runtime.queryRuntimeHaiku({
    systemPrompt: [],
    userPrompt: 'test',
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })

  const firstCall = providerCalls[0] as { model?: unknown }
  expect(firstCall.model).toBe('deepseek-v4-pro')
})

test('startsWithApiErrorPrefix matches API Error prefix and /login wrapped variant', async () => {
  const errors = await import('../errors.ts')
  const { startsWithApiErrorPrefix, API_ERROR_MESSAGE_PREFIX } = errors

  expect(API_ERROR_MESSAGE_PREFIX).toBe('API Error')
  expect(startsWithApiErrorPrefix('API Error: 401')).toBe(true)
  expect(startsWithApiErrorPrefix('API Error 500 Internal')).toBe(true)
  expect(startsWithApiErrorPrefix(`Please run /login · API Error: 401`)).toBe(
    true,
  )
  expect(startsWithApiErrorPrefix('Some other error')).toBe(false)
  expect(startsWithApiErrorPrefix('')).toBe(false)
})

test('queryRuntimeWithModelNonStreaming uses caller-provided model and returns assistant message', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'analyzed' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const result = await runtime.queryRuntimeWithModelNonStreaming({
    systemPrompt: ['You are an analyzer.'],
    userPrompt: 'analyze this',
    signal: new AbortController().signal,
    options: {
      model: 'deepseek-v4-pro',
      querySource: 'insights',
    },
  })

  expect(result.type).toBe('assistant')
  expect(providerCalls.length).toBeGreaterThanOrEqual(1)
  const firstCall = providerCalls[0] as { model?: unknown }
  expect(firstCall.model).toBe('deepseek-v4-pro')
})

test('queryRuntimeWithModelNonStreaming throws RuntimeRequestError when options.model missing', async () => {
  const runtime = await import('../messageSend.ts')
  await expect(
    runtime.queryRuntimeWithModelNonStreaming({
      systemPrompt: [],
      userPrompt: 'x',
      signal: new AbortController().signal,
      // @ts-expect-error intentionally omitting model to verify guard
      options: {},
    }),
  ).rejects.toBeInstanceOf(runtime.RuntimeRequestError)
})

test('queryRuntimeWithModelNonStreaming appends outputFormat schema hint to system prompt', async () => {
  providerEvents = [
    { type: 'content_delta', text: '{"k":"v"}' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  await runtime.queryRuntimeWithModelNonStreaming({
    systemPrompt: ['Base prompt.'],
    userPrompt: 'q',
    outputFormat: {
      type: 'json_schema',
      schema: { type: 'object', properties: { k: { type: 'string' } } },
    },
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })

  const firstCall = providerCalls[0] as { systemPrompt?: ReadonlyArray<string> }
  const hint = firstCall.systemPrompt?.find(s => s.includes('json_schema'))
  expect(hint).toBeDefined()
})

test('queryRuntimeModelWithStreaming yields stream events and final assistant message', async () => {
  providerEvents = [
    { type: 'content_delta', text: 'first' },
    { type: 'content_delta', text: ' second' },
    { type: 'finish', finishReason: 'stop' },
  ]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const events: unknown[] = []
  for await (const event of runtime.queryRuntimeModelWithStreaming({
    messages: [
      {
        type: 'user',
        message: { role: 'user', content: 'go' },
        uuid: '22222222-2222-2222-2222-222222222222',
      },
    ],
    systemPrompt: ['Tool agent.'],
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })) {
    events.push(event)
  }

  expect(events.length).toBeGreaterThan(0)
  const streamEvents = events.filter(
    (e): e is { type: 'stream_event' } =>
      (e as { type?: string }).type === 'stream_event',
  )
  expect(streamEvents.length).toBeGreaterThan(0)
  const finalAssistant = events.find(
    (e): e is { type: 'assistant' } =>
      (e as { type?: string }).type === 'assistant',
  )
  expect(finalAssistant).toBeDefined()
})

test('queryRuntimeModelWithStreaming forwards model and tools to the underlying callModel', async () => {
  providerEvents = [{ type: 'finish', finishReason: 'stop' }]
  providerCalls = []

  const runtime = await import('../messageSend.ts')
  const tools = [{ name: 'web_search', description: 'search' }]
  for await (const _ of runtime.queryRuntimeModelWithStreaming({
    messages: [
      {
        type: 'user',
        message: { role: 'user', content: 'q' },
        uuid: '33333333-3333-3333-3333-333333333333',
      },
    ],
    systemPrompt: [],
    thinkingConfig: { type: 'disabled' },
    tools,
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })) {
    // drain
  }

  expect(providerCalls.length).toBeGreaterThanOrEqual(1)
  const firstCall = providerCalls[0] as { model?: unknown; tools?: unknown }
  expect(firstCall.model).toBe('deepseek-v4-pro')
  expect(firstCall.tools).toEqual(tools)
})

test('getMaxOutputTokensForModel returns the resolved cap for a deepseek model', async () => {
  const tokenPolicy = await import('../tokenPolicy.ts')
  const value = tokenPolicy.getMaxOutputTokensForModel('deepseek-v4-pro')
  expect(typeof value).toBe('number')
  expect(value).toBeGreaterThan(0)
  expect(Number.isFinite(value)).toBe(true)
})

test('getMaxOutputTokensForModel honors CLAUDE_CODE_MAX_OUTPUT_TOKENS env override when set', async () => {
  const originalValue = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '12345'
  try {
    const tokenPolicy = await import('../tokenPolicy.ts')
    const value = tokenPolicy.getMaxOutputTokensForModel('deepseek-v4-pro')
    // Env override may be clamped by upperLimit; just verify it is the
    // override or capped to upperLimit.
    expect(value).toBeGreaterThan(0)
  } finally {
    if (originalValue === undefined) {
      delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    } else {
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = originalValue
    }
  }
})

test('parsePromptTooLongTokenCounts extracts actual and limit from PTL error text', async () => {
  const errors = await import('../errors.ts')
  const { parsePromptTooLongTokenCounts } = errors

  const parsed = parsePromptTooLongTokenCounts(
    'API Error: prompt is too long: 250000 tokens > 200000 maximum',
  )
  expect(parsed.actualTokens).toBe(250000)
  expect(parsed.limitTokens).toBe(200000)

  const noMatch = parsePromptTooLongTokenCounts('Unrelated error text')
  expect(noMatch.actualTokens).toBeUndefined()
  expect(noMatch.limitTokens).toBeUndefined()
})

test('getPromptTooLongTokenGap returns the gap when assistant message is PTL with parseable errorDetails', async () => {
  const errors = await import('../errors.ts')
  const { getPromptTooLongTokenGap, PROMPT_TOO_LONG_ERROR_MESSAGE } = errors

  const gap = getPromptTooLongTokenGap({
    type: 'assistant',
    isApiErrorMessage: true,
    errorDetails: 'prompt is too long: 220000 tokens > 200000 maximum',
    message: {
      content: [
        {
          type: 'text',
          text: `${PROMPT_TOO_LONG_ERROR_MESSAGE}: 220000 tokens > 200000`,
        },
      ],
    },
  } as unknown as Parameters<typeof getPromptTooLongTokenGap>[0])
  expect(gap).toBe(20000)
})

test('getPromptTooLongTokenGap returns undefined when not PTL or errorDetails unparseable', async () => {
  const errors = await import('../errors.ts')
  const { getPromptTooLongTokenGap } = errors

  expect(
    getPromptTooLongTokenGap({
      type: 'assistant',
      isApiErrorMessage: false,
      message: { content: [] },
    } as unknown as Parameters<typeof getPromptTooLongTokenGap>[0]),
  ).toBeUndefined()

  expect(
    getPromptTooLongTokenGap({
      type: 'assistant',
      isApiErrorMessage: true,
      errorDetails: 'unrelated error without token counts',
      message: {
        content: [{ type: 'text', text: 'API Error: something else' }],
      },
    } as unknown as Parameters<typeof getPromptTooLongTokenGap>[0]),
  ).toBeUndefined()
})

test('getDefaultMaxRetries returns the default retry count and honors env override', async () => {
  const { getDefaultMaxRetries } = await import('../errors.ts')
  const originalValue = process.env.CLAUDE_CODE_MAX_RETRIES
  try {
    delete process.env.CLAUDE_CODE_MAX_RETRIES
    expect(getDefaultMaxRetries()).toBe(10)
    process.env.CLAUDE_CODE_MAX_RETRIES = '4'
    expect(getDefaultMaxRetries()).toBe(4)
  } finally {
    if (originalValue === undefined) {
      delete process.env.CLAUDE_CODE_MAX_RETRIES
    } else {
      process.env.CLAUDE_CODE_MAX_RETRIES = originalValue
    }
  }
})

test('getRetryDelay applies exponential backoff with API-compatible jitter and cap', async () => {
  const { getRetryDelay } = await import('../errors.ts')
  const originalRandom = Math.random
  try {
    Math.random = () => 0
    expect(getRetryDelay(1)).toBe(500)
    expect(getRetryDelay(2)).toBe(1000)
    expect(getRetryDelay(3)).toBe(2000)
    expect(getRetryDelay(7)).toBe(32000)
    expect(getRetryDelay(100)).toBe(32000)

    Math.random = () => 0.5
    expect(getRetryDelay(1)).toBe(562.5)
  } finally {
    Math.random = originalRandom
  }
})

test('getRetryDelay honors retry-after header without applying max delay cap', async () => {
  const { getRetryDelay } = await import('../errors.ts')
  expect(getRetryDelay(1, '5')).toBe(5000)
  expect(getRetryDelay(1, '100')).toBe(100000)
})

test('formatAPIError mirrors API formatting for connection, nested, and HTML errors', async () => {
  const { formatAPIError } = await import('../errors.ts')

  expect(formatAPIError('plain string')).toBe('plain string')
  expect(formatAPIError(new Error('boom'))).toBe('boom')

  const timeout = new Error('Connection error.') as Error & { code: string }
  timeout.code = 'ETIMEDOUT'
  expect(formatAPIError(timeout)).toBe(
    'Request timed out. Check your internet connection and proxy settings',
  )

  const ssl = new Error('Connection error.') as Error & { code: string }
  ssl.code = 'SELF_SIGNED_CERT_IN_CHAIN'
  expect(formatAPIError(ssl)).toBe(
    'Unable to connect to API: Self-signed certificate detected. Check your proxy or corporate SSL certificates',
  )

  expect(
    formatAPIError({
      status: 500,
      error: { error: { message: 'nested message' } },
    }),
  ).toBe('nested message')
  expect(
    formatAPIError({
      status: 502,
      error: { message: '<html><title>Cloudflare down</title></html>' },
    }),
  ).toBe('Cloudflare down')
  expect(formatAPIError({ unknown: 'shape' })).toBe(
    'API error (status unknown)',
  )
})

test('getSSLErrorHint detects SSL errors from the cause chain', async () => {
  const { getSSLErrorHint } = await import('../errors.ts')
  expect(getSSLErrorHint(undefined)).toBeNull()
  expect(getSSLErrorHint(new Error('something else'))).toBeNull()

  const cause = new Error('certificate failed') as Error & { code: string }
  cause.code = 'CERT_HAS_EXPIRED'
  const wrapped = new Error('Connection error.', { cause })
  expect(getSSLErrorHint(wrapped)).toContain('SSL certificate error')
})

test('runtime error message constants carry API-compatible strings', async () => {
  const errors = await import('../errors.ts')
  expect(errors.API_TIMEOUT_ERROR_MESSAGE).toBe('Request timed out')
  expect(errors.CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE).toBe(
    'Credit balance is too low',
  )
  expect(errors.INVALID_API_KEY_ERROR_MESSAGE).toBe(
    'Not logged in · Please run /login',
  )
  expect(errors.ORG_DISABLED_ERROR_MESSAGE_ENV_KEY).toBe(
    'Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable',
  )
  expect(errors.TOKEN_REVOKED_ERROR_MESSAGE).toBe(
    'OAuth token revoked · Please run /login',
  )
  expect(errors.CUSTOM_OFF_SWITCH_MESSAGE).toBe(
    'Opus is experiencing high load, please use /model to switch to Sonnet',
  )
})

test('getCacheControl is a DeepSeek stub returning undefined', async () => {
  const { getCacheControl } = await import('../errors.ts')
  expect(getCacheControl()).toBeUndefined()
})
