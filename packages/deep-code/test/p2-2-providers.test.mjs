import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpenAICompatibleProvider } from '../src/services/providers/openai-compatible.mjs'

const messages = [{ role: 'user', content: 'hello' }]

test('ollama provider uses localhost OpenAI-compatible default without an API key', () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })
  const request = provider.buildRequest({ messages, stream: true })
  const body = JSON.parse(request.body)

  assert.equal(provider.name, 'ollama')
  assert.equal(request.url, 'http://localhost:11434/v1/chat/completions')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.Authorization, undefined)
  assert.equal(body.model, 'llama3.1')
  assert.equal(body.stream, true)
})

test('vllm provider requires explicit base URL but no API key by default', () => {
  assert.throws(
    () => createOpenAICompatibleProvider({ providerName: 'vllm' }),
    /vllm requires a base URL/,
  )

  const provider = createOpenAICompatibleProvider({
    providerName: 'vllm',
    baseUrl: 'http://localhost:8000/v1/',
    defaultModel: 'served-model',
  })
  const request = provider.buildRequest({ messages })
  const body = JSON.parse(request.body)

  assert.equal(request.url, 'http://localhost:8000/v1/chat/completions')
  assert.equal(request.headers.Authorization, undefined)
  assert.equal(body.model, 'served-model')
})

test('openai-compatible provider requires a base URL and API key', () => {
  assert.throws(
    () => createOpenAICompatibleProvider({ providerName: 'openai-compatible' }),
    /openai-compatible requires a base URL/,
  )
  assert.throws(
    () =>
      createOpenAICompatibleProvider({
        providerName: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
      }),
    /openai-compatible requires an API key/,
  )

  const provider = createOpenAICompatibleProvider({
    providerName: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    defaultModel: 'custom-model',
  })
  const request = provider.buildRequest({ messages })

  assert.equal(request.url, 'https://example.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer test-key')
})

test('unknown OpenAI-compatible provider names throw', () => {
  assert.throws(
    () => createOpenAICompatibleProvider({ providerName: 'unknown' }),
    /Unknown OpenAI-compatible provider: unknown/,
  )
})

test('buildRequest emits OpenAI chat-completions JSON and strips DeepSeek-only fields', () => {
  const provider = createOpenAICompatibleProvider({
    providerName: 'ollama',
    defaultModel: 'llama3.1:8b',
  })
  const request = provider.buildRequest({
    messages,
    model: 'llama3.1:70b',
    stream: true,
    tools: [{ type: 'function', function: { name: 'search' } }],
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    user_id: 'cache-user',
  })
  const body = JSON.parse(request.body)

  assert.deepEqual(body, {
    model: 'llama3.1:70b',
    messages,
    stream: true,
    tools: [{ type: 'function', function: { name: 'search' } }],
    tool_choice: 'auto',
  })
  assert.equal(Object.hasOwn(body, 'thinking'), false)
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
  assert.equal(Object.hasOwn(body, 'user_id'), false)
})

test('parseStreamChunk parses OpenAI-compatible SSE data lines and DONE sentinel', () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })
  const payload = {
    choices: [{ delta: { content: 'hi' }, finish_reason: null }],
  }

  assert.deepEqual(
    provider.parseStreamChunk(`data: ${JSON.stringify(payload)}\n\n`),
    payload,
  )
  assert.equal(provider.parseStreamChunk('data: [DONE]\n\n'), null)
  assert.equal(provider.parseStreamChunk(': keepalive\n\n'), null)
})

test('mapUsage maps OpenAI usage to runtime non-null usage shape without cache tokens', () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })

  assert.deepEqual(
    provider.mapUsage({
      prompt_tokens: 12,
      completion_tokens: 5,
      total_tokens: 17,
    }),
    {
      input_tokens: 12,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
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
  )
})

test('supports exposes conservative OpenAI-compatible capability defaults', () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })

  assert.equal(provider.supports('streaming'), true)
  assert.equal(provider.supports('tool_calls'), true)
  assert.equal(provider.supports('cache_breakpoint'), false)
  assert.equal(provider.supports('extended_thinking'), false)
  assert.equal(provider.supports('reasoning_content'), false)
  assert.equal(provider.supports('strict_tool_schema'), false)
})

test('adapter satisfies the five-method ModelProvider contract', () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })

  assert.equal(typeof provider.streamQuery, 'function')
  assert.equal(typeof provider.buildRequest, 'function')
  assert.equal(typeof provider.parseStreamChunk, 'function')
  assert.equal(typeof provider.mapUsage, 'function')
  assert.equal(typeof provider.supports, 'function')
})
