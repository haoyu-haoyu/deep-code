import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  loadProviderConfigFile,
  saveProviderConfigFile,
} from '../src/services/providers/deepseek-config-store.mjs'
import { resolveProviderConfig } from '../src/services/providers/provider-config.mjs'
import { createOpenAICompatibleProvider } from '../src/services/providers/openai-compatible.mjs'
import {
  DEFAULT_MODEL_PROVIDER,
  MODEL_PROVIDER_NAMES,
  normalizeModelProviderName,
  resolveModelProvider,
} from '../src/services/providers/registry.mjs'

const messages = [{ role: 'user', content: 'hello' }]
const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const mainSource = join(packageRoot, 'src/main.tsx')
const commandsSource = join(packageRoot, 'src/commands.ts')
const providerCommandIndexSource = join(
  packageRoot,
  'src/commands/provider/index.ts',
)
const providerCommandSource = join(packageRoot, 'src/commands/provider/provider.tsx')

async function createProviderConfigEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-provider-config-'))
  return {
    DEEPCODE_CONFIG_FILE: join(dir, 'deepseek-config.json'),
  }
}

async function loadBuiltModule(source, outfileName) {
  const outdir = await mkdtemp(join(tmpdir(), 'deepcode-provider-command-'))
  const outfile = join(outdir, outfileName)
  const result = spawnSync(
    'bun',
    [
      'build',
      source,
      '--target=node',
      '--format=esm',
      '--outfile',
      outfile,
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  )
  assert.equal(
    result.status,
    0,
    `failed to bundle ${source}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return await import(pathToFileURL(outfile).href)
}

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

test('registry resolves all supported provider names while preserving deepseek default', () => {
  assert.equal(DEFAULT_MODEL_PROVIDER, 'deepseek')
  assert.deepEqual(MODEL_PROVIDER_NAMES, [
    'deepseek',
    'ollama',
    'vllm',
    'openai-compatible',
  ])

  assert.equal(resolveModelProvider({ env: {} }).name, 'deepseek')
  assert.equal(resolveModelProvider({ name: 'deepseek' }).name, 'deepseek')
  assert.equal(resolveModelProvider({ name: 'ollama' }).name, 'ollama')
  assert.equal(
    resolveModelProvider({
      name: 'vllm',
      baseUrl: 'http://localhost:8000/v1',
      defaultModel: 'served-model',
    }).name,
    'vllm',
  )
  assert.equal(
    resolveModelProvider({
      name: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'custom-model',
    }).name,
    'openai-compatible',
  )
})

test('registry keeps anthropic and claude as clear legacy-only unsupported providers', async () => {
  const anthropic = resolveModelProvider({ name: 'anthropic' })
  const claude = resolveModelProvider({ name: 'claude' })

  assert.equal(anthropic.name, 'anthropic')
  assert.equal(claude.name, 'anthropic')
  assert.equal(anthropic.supports('streaming'), false)
  await assert.rejects(
    () => anthropic.buildRequest(),
    /Anthropic provider is legacy-only in Deep Code native mode/,
  )
})

test('registry rejects unknown provider names with valid provider hint', () => {
  assert.throws(
    () => resolveModelProvider({ name: 'unknown' }),
    /Unknown model provider: unknown\. Valid providers: deepseek, ollama, vllm, openai-compatible/,
  )
  assert.equal(normalizeModelProviderName(' OLLAMA '), 'ollama')
})

test('main CLI declares and validates --provider without changing the default provider', async () => {
  const source = await readFile(mainSource, 'utf8')

  assert.match(source, /--provider <provider>/)
  assert.match(source, /parseModelProviderOption/)
  assert.match(source, /process\.env\.DEEPCODE_PROVIDER/)
  assert.match(source, /DEFAULT_MODEL_PROVIDER/)
})

test('provider slash command is registered and exposes valid provider choices', async () => {
  const [commands, index, provider] = await Promise.all([
    readFile(commandsSource, 'utf8'),
    readFile(providerCommandIndexSource, 'utf8'),
    readFile(providerCommandSource, 'utf8'),
  ])

  assert.match(commands, /commands\/provider\/index\.js/)
  assert.match(commands, /\bprovider\b/)
  assert.match(index, /name:\s*'provider'/)
  assert.match(index, /Switch model provider/)
  assert.match(provider, /executeProviderCommand/)
  assert.match(provider, /deepseek\/ollama\/vllm\/openai-compatible/)
  assert.match(provider, /legacy-only, not supported/)
})

test('provider config resolves CLI overrides before provider env, generic env, config, and defaults', async () => {
  const env = {
    ...(await createProviderConfigEnv()),
    OLLAMA_BASE_URL: 'http://env-ollama:11434/v1',
    OLLAMA_MODEL: 'env-llama',
    DEEPCODE_BASE_URL: 'http://generic:9999/v1',
    DEEPCODE_MODEL: 'generic-model',
  }
  saveProviderConfigFile(
    {
      activeProvider: 'ollama',
      providers: {
        ollama: {
          baseUrl: 'http://file-ollama:11434/v1',
          model: 'file-llama',
        },
      },
    },
    { env },
  )

  assert.deepEqual(
    resolveProviderConfig({
      provider: 'ollama',
      cliBaseUrl: 'http://cli-ollama:11434/v1',
      cliModel: 'cli-llama',
      env,
    }),
    {
      provider: 'ollama',
      baseUrl: 'http://cli-ollama:11434/v1',
      apiKey: undefined,
      defaultModel: 'cli-llama',
      requiresApiKey: false,
    },
  )

  assert.equal(
    resolveProviderConfig({ provider: 'ollama', env }).baseUrl,
    'http://env-ollama:11434/v1',
  )
})

test('provider config reads per-provider env and ignores unrelated env vars', async () => {
  const env = {
    ...(await createProviderConfigEnv()),
    VLLM_BASE_URL: 'http://vllm:8000/v1',
    VLLM_API_KEY: 'vllm-key',
    VLLM_MODEL: 'served-model',
    OPENAI_COMPATIBLE_BASE_URL: 'https://openai-compatible.example/v1',
    OPENAI_COMPATIBLE_API_KEY: 'generic-key',
    OPENAI_COMPATIBLE_MODEL: 'generic-model',
    OLLAMA_API_KEY: 'ignored-for-vllm',
  }

  assert.deepEqual(resolveProviderConfig({ provider: 'vllm', env }), {
    provider: 'vllm',
    baseUrl: 'http://vllm:8000/v1',
    apiKey: 'vllm-key',
    defaultModel: 'served-model',
    requiresApiKey: false,
  })
  assert.deepEqual(
    resolveProviderConfig({ provider: 'openai-compatible', env }),
    {
      provider: 'openai-compatible',
      baseUrl: 'https://openai-compatible.example/v1',
      apiKey: 'generic-key',
      defaultModel: 'generic-model',
      requiresApiKey: true,
    },
  )
})

test('provider config keeps existing DeepSeek config readable as legacy fallback', async () => {
  const env = await createProviderConfigEnv()
  await writeFile(
    env.DEEPCODE_CONFIG_FILE,
    JSON.stringify({
      apiKey: 'sk-legacy',
      baseUrl: 'https://legacy.deepseek.example',
      model: 'deepseek-legacy',
      smallModel: 'deepseek-small',
    }),
  )

  assert.deepEqual(resolveProviderConfig({ provider: 'deepseek', env }), {
    provider: 'deepseek',
    baseUrl: 'https://legacy.deepseek.example',
    apiKey: 'sk-legacy',
    defaultModel: 'deepseek-legacy',
    requiresApiKey: true,
  })
  assert.equal(loadProviderConfigFile({ env }).providers.deepseek.apiKey, 'sk-legacy')
})

test('provider command persists selected provider and optional base URL', async () => {
  const env = await createProviderConfigEnv()
  const { executeProviderCommand } = await loadBuiltModule(
    providerCommandSource,
    'provider-command.mjs',
  )

  assert.deepEqual(
    executeProviderCommand('ollama http://local-ollama:11434/v1', env),
    {
      type: 'text',
      value: 'Provider set to ollama (base URL saved)',
    },
  )

  const config = loadProviderConfigFile({ env })
  assert.equal(config.activeProvider, 'ollama')
  assert.equal(config.providers.ollama.baseUrl, 'http://local-ollama:11434/v1')
})

test('main CLI includes provider config override flags without logging API keys', async () => {
  const source = await readFile(mainSource, 'utf8')

  assert.match(source, /--provider-base-url <url>/)
  assert.match(source, /--provider-api-key <key>/)
  assert.match(source, /resolveProviderConfig/)
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*providerApiKey/)
})
