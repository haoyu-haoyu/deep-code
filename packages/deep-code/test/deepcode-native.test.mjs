import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekCacheDiagnostics,
  createDeepSeekProvider,
  createDeepSeekCacheUserId,
  createDeepSeekPrefixHash,
  DEEPSEEK_FINISH_ACTIONS,
  mapMessagesToDeepSeek,
  mapDeepSeekFinishReason,
  mapDeepSeekHttpError,
  parseDeepSeekSSELines,
  runDeepSeekAgent,
  sanitizeSchemaForDeepSeekStrict,
  stableJsonStringify,
  streamDeepSeekResponseBody,
  toolToDeepSeekFunctionSchema,
} from '../src/deepcode/deepseek-native.mjs'
import {
  MODEL_PROVIDER_CAPABILITIES,
  resolveModelProvider,
} from '../src/services/providers/index.mjs'
import {
  createDeepSeekCallModel,
  deepSeekResponseToAssistantMessage,
  resolveDeepSeekRuntimeModel,
} from '../src/query/deepseek-call-model.mjs'

test('buildDeepSeekRequest emits native DeepSeek chat-completions body without Anthropic fields', async () => {
  const request = await buildDeepSeekRequest({
    systemPrompt: ['You are Deep Code.'],
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        inputJSONSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ],
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
  })

  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer sk-test')
  assert.equal(request.body.model, 'deepseek-v4-pro')
  assert.deepEqual(request.body.thinking, { type: 'enabled' })
  assert.equal(request.body.reasoning_effort, 'max')
  assert.deepEqual(request.body.stream_options, { include_usage: true })
  assert.equal(request.body.user_id, 'workspace-1')
  assert.equal(request.body.tools[0].type, 'function')
  assert.equal(request.body.tools[0].function.name, 'Read')

  assert.equal('betas' in request.body, false)
  assert.equal(JSON.stringify(request.body).includes('cache_control'), false)
  assert.equal('anthropic_beta' in request.body, false)
  assert.equal('temperature' in request.body, false)
  assert.equal('top_p' in request.body, false)
})

test('resolveModelProvider defaults to DeepSeek native provider', async () => {
  const provider = resolveModelProvider({
    env: {},
    defaults: {
      env: {
        DEEPSEEK_API_KEY: 'sk-test',
        DEEPSEEK_CACHE_USER_ID: 'workspace-1',
      },
    },
  })

  assert.equal(provider.name, 'deepseek')
  assert.equal(provider.supports(MODEL_PROVIDER_CAPABILITIES.TOOL_CALLS), true)
  assert.equal(provider.supports(MODEL_PROVIDER_CAPABILITIES.REASONING_CONTENT), true)
  assert.equal(provider.supports(MODEL_PROVIDER_CAPABILITIES.CACHE_DIAGNOSTICS), true)

  const request = await provider.buildRequest({
    systemPrompt: ['You are Deep Code.'],
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer sk-test')
  assert.equal(request.body.user_id, 'workspace-1')
})

test('createDeepSeekProvider exposes stream parser and usage mapper', () => {
  const provider = createDeepSeekProvider()
  const events = provider.parseStreamChunk(
    ': keep-alive\n' +
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n' +
      'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":2,"prompt_cache_miss_tokens":3}}\n',
  )

  assert.deepEqual(events, [
    { type: 'content_delta', text: 'ok' },
    {
      type: 'usage',
      usage: {
        prompt_cache_hit_tokens: 2,
        prompt_cache_miss_tokens: 3,
      },
    },
  ])
  assert.deepEqual(provider.mapUsage({
    completion_tokens_details: { reasoning_tokens: 9 },
  }), {
    reasoning_tokens: 9,
  })
})

test('sanitizeSchemaForDeepSeekStrict removes unsupported constraints and closes objects', () => {
  const schema = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 3, maxLength: 20 },
      tags: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: { type: 'string', minLength: 1 },
      },
    },
  })

  assert.deepEqual(schema, {
    type: 'object',
    properties: {
      query: { type: 'string' },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['query', 'tags'],
    additionalProperties: false,
  })
})

test('toolToDeepSeekFunctionSchema supports strict and stable JSON schema output', async () => {
  const tool = await toolToDeepSeekFunctionSchema(
    {
      name: 'Bash',
      async prompt() {
        return 'Run a shell command'
      },
      inputJSONSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', maxLength: 1000 },
          timeout: { type: 'integer' },
        },
      },
    },
    { strict: true },
  )

  assert.equal(tool.type, 'function')
  assert.equal(tool.function.name, 'Bash')
  assert.equal(tool.function.description, 'Run a shell command')
  assert.equal(tool.function.strict, true)
  assert.deepEqual(tool.function.parameters.required, ['command', 'timeout'])
  assert.equal(tool.function.parameters.additionalProperties, false)
  assert.equal('maxLength' in tool.function.parameters.properties.command, false)
})

test('mapMessagesToDeepSeek keeps reasoning_content only for assistant tool-call turns', () => {
  const mapped = mapMessagesToDeepSeek([
    {
      role: 'assistant',
      content: 'No tool needed',
      reasoning_content: 'private reasoning that DeepSeek ignores without tools',
    },
    {
      role: 'assistant',
      content: '',
      reasoning_content: 'I need to inspect a file first.',
      tool_calls: [
        {
          id: 'call_read',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"README.md"}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_read',
      content: 'README contents',
    },
  ])

  assert.equal('reasoning_content' in mapped[0], false)
  assert.equal(mapped[1].reasoning_content, 'I need to inspect a file first.')
  assert.equal(mapped[1].tool_calls[0].id, 'call_read')
  assert.deepEqual(mapped[2], {
    role: 'tool',
    tool_call_id: 'call_read',
    content: 'README contents',
  })
})

test('parseDeepSeekSSELines ignores keep-alive comments and extracts reasoning, content, tool calls and usage', () => {
  const events = parseDeepSeekSSELines([
    ': keep-alive',
    'data: {"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{\\"file_path\\":"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
    'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":42,"prompt_cache_miss_tokens":10}}',
    'data: [DONE]',
  ])

  assert.deepEqual(events, [
    { type: 'reasoning_delta', text: 'think' },
    { type: 'content_delta', text: 'answer' },
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'call_1',
      name: 'Read',
      argumentsDelta: '{"file_path":',
    },
    {
      type: 'tool_call_delta',
      index: 0,
      argumentsDelta: '"README.md"}',
      finishReason: 'tool_calls',
    },
    {
      type: 'usage',
      usage: {
        prompt_cache_hit_tokens: 42,
        prompt_cache_miss_tokens: 10,
      },
    },
    { type: 'done' },
  ])
})

test('parseDeepSeekSSELines extracts usage from DeepSeek final choice chunk', () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"content":"","reasoning_content":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":95,"completion_tokens":31,"total_tokens":126,"completion_tokens_details":{"reasoning_tokens":27},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":95}}',
    'data: [DONE]',
  ])

  assert.deepEqual(events, [
    { type: 'finish', finishReason: 'stop' },
    {
      type: 'usage',
      usage: {
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 95,
        prompt_tokens: 95,
        completion_tokens: 31,
        total_tokens: 126,
        reasoning_tokens: 27,
      },
    },
    { type: 'done' },
  ])
})

test('streamDeepSeekResponseBody buffers split SSE lines', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel"}'))
      controller.enqueue(encoder.encode(',"finish_reason":null}]}\n'))
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n'))
      controller.close()
    },
  })

  const events = []
  for await (const event of streamDeepSeekResponseBody(body)) {
    events.push(event)
  }

  assert.deepEqual(events, [
    { type: 'content_delta', text: 'hel' },
    { type: 'content_delta', text: 'lo' },
    { type: 'done' },
  ])
})

test('collectDeepSeekStreamEvents assembles content, reasoning, tool calls, finish reason and usage', async () => {
  async function* events() {
    yield { type: 'reasoning_delta', text: 'think' }
    yield { type: 'content_delta', text: 'hello' }
    yield {
      type: 'tool_call_delta',
      index: 0,
      id: 'call_1',
      name: 'Read',
      argumentsDelta: '{"file_path":',
    }
    yield {
      type: 'tool_call_delta',
      index: 0,
      argumentsDelta: '"README.md"}',
      finishReason: 'tool_calls',
    }
    yield {
      type: 'usage',
      usage: {
        prompt_cache_hit_tokens: 1,
        prompt_cache_miss_tokens: 2,
      },
    }
  }

  const streamed = []
  const result = await collectDeepSeekStreamEvents(events(), {
    onContent(text) {
      streamed.push(text)
    },
  })

  assert.deepEqual(streamed, ['hello'])
  assert.deepEqual(result, {
    content: 'hello',
    reasoning: 'think',
    usage: {
      prompt_cache_hit_tokens: 1,
      prompt_cache_miss_tokens: 2,
    },
    finishReason: 'tool_calls',
    toolCalls: [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'Read',
          arguments: '{"file_path":"README.md"}',
        },
      },
    ],
  })
})

test('collectDeepSeekStreamEvents records stop finish reason without tool calls', async () => {
  async function* events() {
    yield { type: 'content_delta', text: 'done' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  assert.deepEqual(await collectDeepSeekStreamEvents(events()), {
    content: 'done',
    reasoning: '',
    usage: null,
    finishReason: 'stop',
    toolCalls: [],
  })
})

test('DeepSeek finish reasons map to agent loop actions', () => {
  assert.deepEqual(mapDeepSeekFinishReason('stop'), {
    finishReason: 'stop',
    action: DEEPSEEK_FINISH_ACTIONS.STOP,
    retryable: false,
  })
  assert.deepEqual(mapDeepSeekFinishReason('tool_calls'), {
    finishReason: 'tool_calls',
    action: DEEPSEEK_FINISH_ACTIONS.RUN_TOOLS,
    retryable: false,
  })
  assert.equal(
    mapDeepSeekFinishReason('length').action,
    DEEPSEEK_FINISH_ACTIONS.COMPACT_OR_RESUME,
  )
  assert.equal(
    mapDeepSeekFinishReason('content_filter').action,
    DEEPSEEK_FINISH_ACTIONS.CONTENT_FILTER,
  )
  assert.deepEqual(mapDeepSeekFinishReason('insufficient_system_resource'), {
    finishReason: 'insufficient_system_resource',
    action: DEEPSEEK_FINISH_ACTIONS.DOWNGRADE_OR_RETRY,
    retryable: true,
    retryStrategy: 'lower_reasoning_effort_or_use_flash',
  })
})

test('DeepSeek HTTP errors map to retry strategies', () => {
  assert.deepEqual(mapDeepSeekHttpError({
    status: 429,
    headers: { 'retry-after': '7' },
  }), {
    status: 429,
    code: undefined,
    message: '',
    retryable: true,
    retryAfterSeconds: 7,
    retryStrategy: 'exponential_backoff',
  })

  assert.equal(mapDeepSeekHttpError({ status: 503 }).retryable, true)
  assert.equal(mapDeepSeekHttpError({ status: 400 }).retryable, false)
})

test('createDeepSeekCacheUserId is deterministic and safe for DeepSeek user_id', () => {
  assert.equal(
    createDeepSeekCacheUserId('/tmp/my workspace'),
    createDeepSeekCacheUserId('/tmp/my workspace'),
  )
  assert.match(createDeepSeekCacheUserId('/tmp/my workspace'), /^dc_[A-Za-z0-9_-]+$/)
})

test('DeepSeek cache diagnostics and prefix hash are stable', () => {
  assert.deepEqual(createDeepSeekCacheDiagnostics({
    prompt_cache_hit_tokens: 75,
    prompt_cache_miss_tokens: 25,
  }), {
    promptCacheHitTokens: 75,
    promptCacheMissTokens: 25,
    promptCacheTotalTokens: 100,
    promptCacheHitRate: 0.75,
  })

  assert.equal(
    stableJsonStringify({ z: 1, a: { c: 3, b: 2 } }),
    '{"a":{"b":2,"c":3},"z":1}',
  )

  const prefixA = createDeepSeekPrefixHash({
    systemPrompt: ['fixed'],
    tools: [{ name: 'Read', schema: { b: 1, a: 2 } }],
    repoSummary: 'repo',
  })
  const prefixB = createDeepSeekPrefixHash({
    repoSummary: 'repo',
    tools: [{ schema: { a: 2, b: 1 }, name: 'Read' }],
    systemPrompt: ['fixed'],
  })
  assert.equal(prefixA, prefixB)
})

test('runDeepSeekAgent executes tool calls and preserves reasoning_content across tool turns', async () => {
  const requests = []
  const result = await runDeepSeekAgent({
    prompt: 'Read README.md',
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    tools: [
      {
        name: 'Read',
        description: 'Read a file',
        inputJSONSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
        async execute(input) {
          return `contents:${input.file_path}`
        },
      },
    ],
    async complete(request) {
      requests.push(request.body.messages)
      if (requests.length === 1) {
        return {
          content: '',
          reasoning: 'Need to inspect the requested file.',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'call_read',
              type: 'function',
              function: {
                name: 'Read',
                arguments: '{"file_path":"README.md"}',
              },
            },
          ],
        }
      }
      return {
        content: 'README.md says contents:README.md',
        reasoning: '',
        finishReason: 'stop',
        toolCalls: [],
      }
    },
  })

  assert.equal(result.content, 'README.md says contents:README.md')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].at(-2), {
    role: 'assistant',
    content: '',
    reasoning_content: 'Need to inspect the requested file.',
    tool_calls: [
      {
        id: 'call_read',
        type: 'function',
        function: {
          name: 'Read',
          arguments: '{"file_path":"README.md"}',
        },
      },
    ],
  })
  assert.deepEqual(requests[1].at(-1), {
    role: 'tool',
    tool_call_id: 'call_read',
    content: 'contents:README.md',
  })
})

test('runDeepSeekAgent can drive tool loop through provider streams', async () => {
  const requests = []
  const provider = {
    streamQuery(request) {
      requests.push(request.body.messages)
      if (requests.length === 1) {
        return (async function* firstTurn() {
          yield { type: 'reasoning_delta', text: 'Need the virtual file.' }
          yield {
            type: 'tool_call_delta',
            index: 0,
            id: 'call_read',
            name: 'Read',
            argumentsDelta: '{"file_path":"package.json"}',
            finishReason: 'tool_calls',
          }
        })()
      }
      return (async function* secondTurn() {
        yield { type: 'content_delta', text: 'virtual-content:package.json' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    },
  }

  const result = await runDeepSeekAgent({
    prompt: 'Read package.json',
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    provider,
    tools: [
      {
        name: 'Read',
        description: 'Read a virtual file',
        inputJSONSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
        async execute(input) {
          return `virtual-content:${input.file_path}`
        },
      },
    ],
  })

  assert.equal(result.content, 'virtual-content:package.json')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].at(-2).reasoning_content, 'Need the virtual file.')
  assert.deepEqual(requests[1].at(-1), {
    role: 'tool',
    tool_call_id: 'call_read',
    content: 'virtual-content:package.json',
  })
})

test('deepSeekResponseToAssistantMessage emits Claude Code compatible tool_use blocks', () => {
  const message = deepSeekResponseToAssistantMessage(
    {
      content: 'I will read it.',
      reasoning: 'Need file contents first.',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_read',
          type: 'function',
          function: {
            name: 'Read',
            arguments: '{"file_path":"README.md"}',
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_cache_hit_tokens: 7,
        prompt_cache_miss_tokens: 3,
      },
    },
    {
      model: 'deepseek-v4-pro',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      uuid: () => 'uuid-fixed',
    },
  )

  assert.equal(message.type, 'assistant')
  assert.equal(message.message.stop_reason, 'tool_use')
  assert.deepEqual(message.message.content, [
    { type: 'thinking', thinking: 'Need file contents first.' },
    { type: 'text', text: 'I will read it.' },
    {
      type: 'tool_use',
      id: 'call_read',
      name: 'Read',
      input: { file_path: 'README.md' },
    },
  ])
  assert.deepEqual(message.message.usage, {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 7,
  })
})

test('createDeepSeekCallModel yields assistant messages from provider events', async () => {
  const requests = []
  const callModel = createDeepSeekCallModel({
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
          yield {
            type: 'usage',
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
            },
          }
        })()
      },
    },
    now: () => new Date('2026-05-04T00:00:00.000Z'),
    uuid: () => 'uuid-fixed',
  })

  const messages = []
  for await (const message of callModel({
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: ['You are Deep Code.'],
    tools: [],
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })) {
    messages.push(message)
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'deepseek-v4-pro')
  assert.deepEqual(messages.map(message => message.message.content), [
    [{ type: 'text', text: 'done' }],
  ])
  assert.equal(messages[0].message.stop_reason, 'stop')
})

test('resolveDeepSeekRuntimeModel avoids forwarding Claude model names to DeepSeek', () => {
  const previousModel = process.env.DEEPSEEK_MODEL
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash'
  try {
    assert.equal(resolveDeepSeekRuntimeModel('deepseek-v4-pro'), 'deepseek-v4-pro')
    assert.equal(resolveDeepSeekRuntimeModel('claude-sonnet-4-5'), 'deepseek-v4-flash')
    assert.equal(resolveDeepSeekRuntimeModel(undefined), 'deepseek-v4-flash')
  } finally {
    if (previousModel === undefined) {
      delete process.env.DEEPSEEK_MODEL
    } else {
      process.env.DEEPSEEK_MODEL = previousModel
    }
  }
})
