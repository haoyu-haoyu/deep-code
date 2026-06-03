import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDeepSeekCallModel } from '../src/query/deepseek-call-model.mjs'
import {
  providerSupports,
} from '../src/deepcode/provider-capabilities.mjs'
import {
  compactDeepCodeConversation,
  formatDeepCodeCompactResult,
} from '../src/deepcode/compact.mjs'
import {
  deepCodeStatusReportToProperties,
} from '../src/deepcode/status.mjs'
import {
  formatDeepSeekDoctorReport,
} from '../src/deepcode/doctor.mjs'
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
const messageSendSource = join(packageRoot, 'src/services/runtime/messageSend.ts')
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

function createMockProvider({ name, capabilities = [], events = [] } = {}) {
  const calls = []
  const capabilitySet = new Set(capabilities)
  return {
    name,
    calls,
    supports(capability) {
      return capabilitySet.has(capability)
    },
    async buildRequest(context = {}) {
      calls.push({ buildRequest: context })
      return context
    },
    async *streamQuery(context = {}) {
      calls.push(context)
      for (const event of events) {
        yield event
      }
    },
  }
}

async function drainCallModel(callModel, args) {
  const messages = []
  for await (const message of callModel(args)) {
    messages.push(message)
  }
  return messages
}

async function withCacheStatsPath(callback) {
  const previous = process.env.DEEPCODE_CACHE_STATS_PATH
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-p2-2-cache-'))
  const path = join(dir, 'cache.json')
  process.env.DEEPCODE_CACHE_STATS_PATH = path
  try {
    return await callback(path)
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPCODE_CACHE_STATS_PATH
    } else {
      process.env.DEEPCODE_CACHE_STATS_PATH = previous
    }
    if (existsSync(path)) await unlink(path)
  }
}

function createStatusReport({ capabilities }) {
  return {
    provider: 'ollama',
    providerCapabilities: capabilities,
    config: {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      smallModel: 'llama3.1',
      thinking: 'enabled',
      reasoningEffort: 'max',
      cacheUserId: 'dc_test',
    },
    contextPolicy: {
      contextWindowTokens: 200_000,
      effectiveContextWindowTokens: 180_000,
      reservedOutputTokens: 20_000,
      autoCompactThresholdTokens: 167_000,
      autoCompactEnabled: true,
    },
    harnessConfig: {
      mode: 'off',
      maxAgents: 0,
      promptPack: 'deepseek-v1',
      strictTools: 'off',
    },
    harnessRuntimeDecision: null,
    harnessAgentLifecycle: null,
    cacheStats: {
      lastPromptCacheHitTokens: 7,
      lastPromptCacheMissTokens: 3,
      lastPromptCacheHitRate: 0.7,
      totalPromptCacheHitTokens: 70,
      totalPromptCacheMissTokens: 30,
      totalPromptCacheHitRate: 0.7,
      updatedAt: '2026-05-27T00:00:00.000Z',
    },
    stablePrefix: { prefixHash: 'prefix_hash' },
    apiKeyConfigured: false,
  }
}

test('ollama provider uses localhost OpenAI-compatible default without an API key', async () => {
  const provider = createOpenAICompatibleProvider({ providerName: 'ollama' })
  const request = await provider.buildRequest({ messages, stream: true })
  const body = JSON.parse(request.body)

  assert.equal(provider.name, 'ollama')
  assert.equal(request.url, 'http://localhost:11434/v1/chat/completions')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.Authorization, undefined)
  assert.equal(body.model, 'llama3.1')
  assert.equal(body.stream, true)
})

test('vllm provider requires explicit base URL but no API key by default', async () => {
  assert.throws(
    () => createOpenAICompatibleProvider({ providerName: 'vllm' }),
    /vllm requires a base URL/,
  )

  const provider = createOpenAICompatibleProvider({
    providerName: 'vllm',
    baseUrl: 'http://localhost:8000/v1/',
    defaultModel: 'served-model',
  })
  const request = await provider.buildRequest({ messages })
  const body = JSON.parse(request.body)

  assert.equal(request.url, 'http://localhost:8000/v1/chat/completions')
  assert.equal(request.headers.Authorization, undefined)
  assert.equal(body.model, 'served-model')
})

test('openai-compatible provider requires a base URL and API key', async () => {
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
  const request = await provider.buildRequest({ messages })

  assert.equal(request.url, 'https://example.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer test-key')
})

test('unknown OpenAI-compatible provider names throw', () => {
  assert.throws(
    () => createOpenAICompatibleProvider({ providerName: 'unknown' }),
    /Unknown OpenAI-compatible provider: unknown/,
  )
})

test('buildRequest emits OpenAI chat-completions JSON and strips DeepSeek-only fields', async () => {
  const provider = createOpenAICompatibleProvider({
    providerName: 'ollama',
    defaultModel: 'llama3.1:8b',
  })
  const request = await provider.buildRequest({
    messages,
    model: 'llama3.1:70b',
    stream: true,
    tools: [{ name: 'search', description: 'web search' }],
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    user_id: 'cache-user',
  })
  const body = JSON.parse(request.body)

  assert.equal(body.model, 'llama3.1:70b')
  assert.deepEqual(body.messages, messages) // already-OpenAI messages pass through
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true }) // usage opt-in
  assert.equal(body.tool_choice, 'auto')
  // runtime tool object → OpenAI function schema (name + resolved description)
  assert.equal(body.tools.length, 1)
  assert.equal(body.tools[0].type, 'function')
  assert.equal(body.tools[0].function.name, 'search')
  assert.equal(body.tools[0].function.description, 'web search')
  // DeepSeek-only request fields are never emitted
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
  // "legacy-only, not supported" migrated to the i18n catalog
  // (command.provider.legacyOnly); provider.tsx now renders the key.
  assert.match(provider, /command\.provider\.legacyOnly/)
  const enCatalog = await readFile(
    join(packageRoot, 'src/i18n/messages/en.ts'),
    'utf8',
  )
  assert.match(enCatalog, /legacy-only, not supported/)
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

test('providerSupports maps P2.2 capability names without provider-name hardcoding', () => {
  const deepseekLike = createMockProvider({
    name: 'deepseek',
    capabilities: ['cache_diagnostics', 'reasoning_content', 'strict_tools'],
  })
  const ollama = createOpenAICompatibleProvider({ providerName: 'ollama' })

  assert.equal(providerSupports(deepseekLike, 'extended_thinking'), true)
  assert.equal(providerSupports(deepseekLike, 'reasoning_effort'), true)
  assert.equal(providerSupports(deepseekLike, 'reasoning_content'), true)
  assert.equal(providerSupports(deepseekLike, 'cache_breakpoint'), true)
  assert.equal(providerSupports(deepseekLike, 'stable_prefix_cache'), true)
  assert.equal(providerSupports(deepseekLike, 'strict_tool_schema'), true)
  assert.equal(providerSupports(ollama, 'extended_thinking'), false)
  assert.equal(providerSupports(ollama, 'cache_breakpoint'), false)
})

test('createDeepSeekCallModel strips reasoning, effort, and cache telemetry for providers without capabilities', async () => {
  const provider = createMockProvider({
    name: 'ollama',
    capabilities: ['streaming', 'tool_calls'],
    events: [
      { type: 'reasoning_delta', text: 'hidden plan' },
      { type: 'content_delta', text: 'visible answer' },
      { type: 'finish', finishReason: 'stop' },
      {
        type: 'usage',
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
          prompt_cache_hit_tokens: 5,
          prompt_cache_miss_tokens: 4,
        },
      },
    ],
  })
  const callModel = createDeepSeekCallModel({
    provider,
    uuid: () => '00000000-0000-0000-0000-000000000000',
    now: () => new Date('2026-05-27T00:00:00.000Z'),
  })

  await withCacheStatsPath(async cacheStatsPath => {
    const messages = await drainCallModel(callModel, {
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: ['system'],
      tools: [],
      signal: new AbortController().signal,
      options: { model: 'llama3.1', effortValue: 'max' },
    })
    const assistant = messages.find(message => message.type === 'assistant')

    assert.equal(provider.calls[0].reasoningEffort, undefined)
    assert.equal(Object.hasOwn(provider.calls[0], 'stablePrefix'), false)
    assert.equal(
      assistant.message.content.some(block => block.type === 'thinking'),
      false,
    )
    assert.equal(assistant.message.usage.cache_creation_input_tokens, 0)
    assert.equal(assistant.message.usage.cache_read_input_tokens, 0)
    assert.equal(existsSync(cacheStatsPath), false)
  })
})

test('createDeepSeekCallModel preserves DeepSeek reasoning and cache behavior through supports aliases', async () => {
  const provider = createMockProvider({
    name: 'deepseek',
    capabilities: ['cache_diagnostics', 'reasoning_content', 'strict_tools'],
    events: [
      { type: 'reasoning_delta', text: 'think' },
      { type: 'content_delta', text: 'answer' },
      { type: 'finish', finishReason: 'stop' },
      {
        type: 'usage',
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
          prompt_cache_hit_tokens: 5,
          prompt_cache_miss_tokens: 4,
        },
      },
    ],
  })
  const callModel = createDeepSeekCallModel({
    provider,
    uuid: () => '00000000-0000-0000-0000-000000000000',
    now: () => new Date('2026-05-27T00:00:00.000Z'),
  })

  await withCacheStatsPath(async cacheStatsPath => {
    const messages = await drainCallModel(callModel, {
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: ['system'],
      tools: [],
      signal: new AbortController().signal,
      options: { model: 'deepseek-v4-pro', effortValue: 'max' },
    })
    const assistant = messages.find(message => message.type === 'assistant')

    assert.equal(provider.calls[0].reasoningEffort, 'max')
    assert.equal(typeof provider.calls[0].stablePrefix, 'object')
    assert.equal(
      assistant.message.content.some(block => block.type === 'thinking'),
      true,
    )
    assert.equal(assistant.message.usage.cache_creation_input_tokens, 4)
    assert.equal(assistant.message.usage.cache_read_input_tokens, 5)
    assert.equal(existsSync(cacheStatsPath), true)
  })
})

test('status properties hide DeepSeek-only cache and reasoning rows for providers without capabilities', () => {
  const report = createStatusReport({
    capabilities: {
      cache_breakpoint: false,
      extended_thinking: false,
      reasoning_effort: false,
      reasoning_content: false,
      stable_prefix_cache: false,
      user_id: false,
    },
  })
  const labels = deepCodeStatusReportToProperties(report).map(item => item.label)

  assert.equal(labels.includes('Thinking'), false)
  assert.equal(labels.includes('Reasoning effort'), false)
  assert.equal(labels.includes('Cache user_id'), false)
  assert.equal(labels.includes('Stable prefix hash'), false)
  assert.equal(labels.includes('Cache hit rate'), false)
})

test('doctor formatting hides DeepSeek-only diagnostics when capability flags are false', () => {
  const report = {
    config: {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      smallModel: 'llama3.1',
      thinking: 'enabled',
      reasoningEffort: 'max',
      cacheUserId: 'dc_test',
      harnessMode: 'off',
      harnessMaxAgents: 0,
      promptPack: 'deepseek-v1',
      strictTools: 'off',
      apiKeyConfigured: false,
    },
    capabilities: {
      cache_breakpoint: false,
      extended_thinking: false,
      reasoning_effort: false,
      user_id: false,
    },
    checks: [],
    summary: { pass: 0, warn: 0, fail: 0, skip: 0 },
  }
  const formatted = formatDeepSeekDoctorReport(report)

  assert.doesNotMatch(formatted, /^Thinking:/m)
  assert.doesNotMatch(formatted, /^Reasoning effort:/m)
  assert.doesNotMatch(formatted, /^Cache user_id:/m)
})

test('compact suppresses cache diagnostics for providers without cache capability', async () => {
  const provider = createMockProvider({
    name: 'openai-compatible',
    capabilities: ['streaming', 'tool_calls'],
    events: [
      { type: 'content_delta', text: 'summary' },
      { type: 'finish', finishReason: 'stop' },
      {
        type: 'usage',
        usage: {
          prompt_cache_hit_tokens: 12,
          prompt_cache_miss_tokens: 3,
        },
      },
    ],
  })
  const result = await compactDeepCodeConversation({
    messages: [{ role: 'user', content: 'long tail' }],
    stablePrefix: {
      systemPrompt: ['stable'],
      prefixHash: 'prefix_hash',
      componentHashes: {},
    },
    provider,
    env: {},
    cwd: packageRoot,
  })

  assert.equal(result.cacheDiagnostics, null)
  assert.equal(Object.hasOwn(provider.calls[0].buildRequest, 'thinking'), false)
  assert.doesNotMatch(formatDeepCodeCompactResult(result), /^Cache:/m)
})

test('runtime messageSend gates provider-specific routing fields through provider.supports', async () => {
  const source = await readFile(messageSendSource, 'utf8')

  assert.match(source, /providerSupports\(provider,\s*'extended_thinking'\)/)
  assert.match(source, /providerSupports\(provider,\s*'reasoning_effort'\)/)
  assert.match(source, /providerSupports\(state\.provider,\s*'reasoning_content'\)/)
  assert.match(source, /updateUsage\(state\.usage,\s*event\.usage,\s*\{\s*provider: state\.provider/)
  assert.doesNotMatch(source, /provider\s*={2,3}\s*['"]deepseek['"]/)
})
