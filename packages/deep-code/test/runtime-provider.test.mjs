import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isDeepSeekProvider,
  resolveRuntimeModelProvider,
} from '../src/services/providers/runtime-provider.mjs'
import { createDeepSeekProvider } from '../src/services/providers/deepseek.mjs'
import {
  createDeepSeekCallModel,
  resolveDeepSeekRuntimeModel,
} from '../src/query/deepseek-call-model.mjs'

// ── runtime multi-provider wiring ────────────────────────────────────────────
// resolveRuntimeModelProvider is the seam that turns the previously-latent
// provider registry into the runtime's actual provider. The DEFAULT (no
// DEEPCODE_PROVIDER) must return the exact DeepSeek provider as before — the
// prompt-cache moat depends on a byte-identical request — and an explicit
// non-deepseek provider must switch the runtime to it, end to end.

// --- resolveRuntimeModelProvider: config → provider --------------------------

test('default (no config) resolves the DeepSeek provider, byte-identically', () => {
  const provider = resolveRuntimeModelProvider({ env: {} })
  const baseline = createDeepSeekProvider()
  assert.equal(provider.name, baseline.name)
  assert.equal(provider.name, 'deepseek')
  // same capability surface as the pre-wiring hard default
  for (const cap of [
    'streaming',
    'tool_calls',
    'reasoning_content',
    'cache_diagnostics',
    'stable_prefix_cache',
    'cache_breakpoint',
  ]) {
    assert.equal(provider.supports(cap), baseline.supports(cap), `cap ${cap}`)
  }
})

test('DEEPCODE_PROVIDER switches the runtime to an OpenAI-compatible provider', () => {
  const ollama = resolveRuntimeModelProvider({ env: { DEEPCODE_PROVIDER: 'ollama' } })
  assert.equal(ollama.name, 'ollama')

  const openai = resolveRuntimeModelProvider({
    env: {
      DEEPCODE_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_MODEL: 'gpt-x',
    },
  })
  assert.equal(openai.name, 'openai-compatible')
  assert.equal(openai.supports('streaming'), true)
  assert.equal(openai.supports('reasoning_content'), false)
})

test('the provider config file activeProvider is honored', () => {
  const provider = resolveRuntimeModelProvider({
    env: {},
    fileConfig: {
      activeProvider: 'vllm',
      providers: { vllm: { baseUrl: 'http://localhost:8000/v1' } },
    },
  })
  assert.equal(provider.name, 'vllm')
})

test('a misconfigured provider fails fast (no silent fallback to DeepSeek)', () => {
  assert.throws(
    () => resolveRuntimeModelProvider({ env: { DEEPCODE_PROVIDER: 'openai-compatible' } }),
    /openai-compatible requires a base URL/,
  )
})

// --- isDeepSeekProvider: gates DeepSeek-only auto-routing ---------------------

test('isDeepSeekProvider gates auto-routing to the DeepSeek provider only', () => {
  // model='auto' routing is DeepSeek-specific; it must never reroute a
  // non-DeepSeek user's request to DeepSeek.
  assert.equal(isDeepSeekProvider(resolveRuntimeModelProvider({ env: {} })), true)
  assert.equal(
    isDeepSeekProvider(resolveRuntimeModelProvider({ env: { DEEPCODE_PROVIDER: 'ollama' } })),
    false,
  )
  assert.equal(isDeepSeekProvider({ name: 'deepseek' }), true)
  assert.equal(isDeepSeekProvider({ name: 'openai-compatible' }), false)
  assert.equal(isDeepSeekProvider(undefined), false)
  assert.equal(isDeepSeekProvider({}), false)
})

// --- per-request model override (provider-aware model resolution) ------------

test('resolveDeepSeekRuntimeModel passes any model through for non-DeepSeek, guards DeepSeek', async () => {
  const ds = resolveRuntimeModelProvider({ env: {} })
  const oa = resolveRuntimeModelProvider({
    env: {
      DEEPCODE_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://x/v1',
      OPENAI_COMPATIBLE_API_KEY: 'k',
      OPENAI_COMPATIBLE_MODEL: 'gpt-x',
    },
  })

  // non-DeepSeek: any concrete model passes through; 'auto'/none → provider default
  assert.equal(resolveDeepSeekRuntimeModel('gpt-4o-mini', { provider: oa }), 'gpt-4o-mini')
  assert.equal(resolveDeepSeekRuntimeModel('llama3.1:70b', { provider: oa }), 'llama3.1:70b')
  assert.equal(resolveDeepSeekRuntimeModel('auto', { provider: oa }), undefined)
  assert.equal(resolveDeepSeekRuntimeModel(undefined, { provider: oa }), undefined)

  // DeepSeek: deepseek-* passes through; a foreign model NEVER leaks (env fallback)
  assert.equal(resolveDeepSeekRuntimeModel('deepseek-v4-flash', { provider: ds }), 'deepseek-v4-flash')
  await withEnv({ DEEPSEEK_MODEL: 'deepseek-v4-pro' }, () => {
    assert.equal(resolveDeepSeekRuntimeModel('gpt-4o', { provider: ds }), 'deepseek-v4-pro')
  })

  // backward-compat: no provider → DeepSeek semantics
  assert.equal(resolveDeepSeekRuntimeModel('deepseek-x'), 'deepseek-x')
})

// --- end-to-end: the DEFAULT wiring streams through the configured provider ---

const enc = new TextEncoder()
const sse = obj => `data: ${JSON.stringify(obj)}\n\n`

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides)
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  // assign — deleting keys whose override is undefined (process.env coerces an
  // assigned `undefined` to the string 'undefined', which is not the same as unset)
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k]
    else process.env[k] = overrides[k]
  }
  return (async () => {
    try {
      return await fn()
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  })()
}

test('createDeepSeekCallModel() with DEEPCODE_PROVIDER set streams via the configured provider end to end', async () => {
  await withEnv(
    {
      DEEPCODE_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_MODEL: 'gpt-x',
    },
    async () => {
      let captured
      const fetch = async (url, opts) => {
        captured = { url, body: JSON.parse(opts.body) }
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield enc.encode(sse({ choices: [{ delta: { content: 'Hello' } }] }))
            yield enc.encode(
              sse({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }),
            )
            yield enc.encode('data: [DONE]\n\n')
          })(),
        }
      }

      // No explicit provider → resolved from DEEPCODE_PROVIDER (the wiring under test).
      const callModel = createDeepSeekCallModel()
      const events = []
      let assistant
      for await (const message of callModel({
        systemPrompt: ['You are DeepCode.'],
        messages: [
          { role: 'user', content: 'hi' },
          {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 't1', name: 'ls', input: { path: '.' } }] },
          },
          {
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] },
          },
        ],
        tools: [
          { name: 'ls', description: 'list', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
        ],
        options: { fetchOverride: fetch },
      })) {
        if (message.type === 'stream_event') events.push(message.event.type)
        else if (message.type === 'assistant') assistant = message
      }

      // routed to the configured OpenAI-compatible endpoint
      assert.equal(captured.url, 'https://api.example.com/v1/chat/completions')
      assert.equal(captured.body.model, 'gpt-x')
      // system prompt → leading system message; conversation → OpenAI shape
      assert.equal(captured.body.messages[0].role, 'system')
      assert.match(captured.body.messages[0].content, /You are DeepCode\./)
      assert.deepEqual(
        captured.body.messages.map(m => m.role),
        ['system', 'user', 'assistant', 'tool'],
      )
      assert.equal(captured.body.messages[2].tool_calls[0].function.name, 'ls')
      assert.equal(captured.body.messages[3].tool_call_id, 't1')
      // runtime tool → function schema with its real parameters
      assert.equal(captured.body.tools[0].function.name, 'ls')
      assert.deepEqual(captured.body.tools[0].function.parameters.properties.path, {
        type: 'string',
      })
      // and the SSE streamed back as Claude-Code events + a final assistant message
      assert.ok(events.includes('message_start'))
      assert.ok(events.includes('content_block_delta'))
      assert.equal(assistant.message.content.find(b => b.type === 'text').text, 'Hello')
    },
  )
})

test('a per-request model override reaches the configured non-DeepSeek provider', async () => {
  await withEnv(
    {
      DEEPCODE_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_MODEL: 'gpt-x', // the configured DEFAULT
    },
    async () => {
      let captured
      const fetch = async (url, opts) => {
        captured = JSON.parse(opts.body)
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield enc.encode('data: [DONE]\n\n')
          })(),
        }
      }
      // options.model picks a DIFFERENT model per request — it must override the
      // provider's configured default (gpt-x).
      // eslint-disable-next-line no-empty
      for await (const _ of createDeepSeekCallModel()({
        messages: [{ role: 'user', content: 'hi' }],
        options: { fetchOverride: fetch, model: 'gpt-4o-mini' },
      })) {
      }
      assert.equal(captured.model, 'gpt-4o-mini') // override won, not the default gpt-x
    },
  )
})
