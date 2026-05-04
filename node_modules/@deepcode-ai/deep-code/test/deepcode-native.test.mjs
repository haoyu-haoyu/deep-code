import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepSeekRequest,
  createDeepSeekCacheUserId,
  mapMessagesToDeepSeek,
  parseDeepSeekSSELines,
  runDeepSeekAgent,
  sanitizeSchemaForDeepSeekStrict,
  toolToDeepSeekFunctionSchema,
} from '../src/deepcode/deepseek-native.mjs'

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

test('createDeepSeekCacheUserId is deterministic and safe for DeepSeek user_id', () => {
  assert.equal(
    createDeepSeekCacheUserId('/tmp/my workspace'),
    createDeepSeekCacheUserId('/tmp/my workspace'),
  )
  assert.match(createDeepSeekCacheUserId('/tmp/my workspace'), /^dc_[A-Za-z0-9_-]+$/)
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
