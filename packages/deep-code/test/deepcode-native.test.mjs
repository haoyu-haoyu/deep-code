import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildDeepSeekRequest,
  calculateDeepSeekRetryDelayMs,
  collectDeepSeekStreamEvents,
  createDeepSeekWarmupContext,
  createDeepSeekCacheDiagnostics,
  createDeepSeekProvider,
  createDeepSeekCacheUserId,
  createDeepSeekPrefixHash,
  DEEPSEEK_FINISH_ACTIONS,
  formatDeepSeekWarmupResult,
  mapMessagesToDeepSeek,
  mapDeepSeekFinishReason,
  mapDeepSeekHttpError,
  parseDeepSeekSSELines,
  runDeepSeekAgent,
  sanitizeSchemaForDeepSeekStrict,
  stableJsonStringify,
  streamDeepSeekQuery,
  streamDeepSeekResponseBody,
  toolToDeepSeekFunctionSchema,
  warmDeepSeekCache,
} from '../src/deepcode/deepseek-native.mjs'
import {
  MODEL_PROVIDER_CAPABILITIES,
  resolveModelProvider,
} from '../src/services/providers/index.mjs'
import {
  createDeepSeekCallModel,
  deepSeekResponseToAssistantMessage,
  resolveDeepSeekReasoningEffort,
  resolveDeepSeekRuntimeModel,
} from '../src/query/deepseek-call-model.mjs'
import {
  createDeepSeekDoctorReport,
  formatDeepSeekDoctorReport,
  hasFailingDoctorChecks,
} from '../src/deepcode/doctor.mjs'
import {
  createDeepSeekCacheStats,
  formatDeepSeekCacheStatus,
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from '../src/deepcode/cache-telemetry.mjs'
import {
  applyDeepCodeCliEnvOverrides,
  parseDeepCodeArgs,
} from '../src/deepcode/cli-args.mjs'
import {
  createDeepCodeStableTools,
  createDeepSeekLocalTools,
  runDeepSeekLocalToolChain,
} from '../src/deepcode/local-toolchain.mjs'
import {
  createDeepCodeStablePrefix,
  formatDeepCodePrefixStatus,
} from '../src/deepcode/stable-prefix.mjs'
import {
  compactDeepCodeConversation,
  formatDeepCodeCompactResult,
} from '../src/deepcode/compact.mjs'

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

test('parseDeepCodeArgs recognizes print mode and DeepSeek-native CLI overrides', () => {
  const parsed = parseDeepCodeArgs([
    '-p',
    '--model',
    'deepseek-v4-flash',
    '--base-url=https://api.deepseek.com/beta',
    '--max-tokens',
    '123',
    '--thinking',
    'disabled',
    '--reasoning-effort=max',
    '--cache-user-id',
    'dc_workspace',
    'explain',
    'repo',
  ])

  assert.equal(parsed.printMode, true)
  assert.equal(parsed.command, null)
  assert.deepEqual(parsed.promptArgs, ['explain', 'repo'])
  assert.deepEqual(parsed.envOverrides, {
    DEEPSEEK_MODEL: 'deepseek-v4-flash',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com/beta',
    DEEPCODE_MAX_TOKENS: '123',
    DEEPSEEK_THINKING: 'disabled',
    DEEPSEEK_REASONING_EFFORT: 'max',
    DEEPCODE_CACHE_USER_ID: 'dc_workspace',
  })
})

test('parseDeepCodeArgs gives commands precedence over print mode', () => {
  const parsed = parseDeepCodeArgs([
    '--print',
    '--doctor',
    '--no-live',
    '--api-key',
    'sk-test',
  ])

  assert.equal(parsed.printMode, true)
  assert.equal(parsed.command, 'doctor')
  assert.equal(parsed.live, false)
  assert.deepEqual(parsed.promptArgs, [])
  assert.deepEqual(parsed.envOverrides, {
    DEEPSEEK_API_KEY: 'sk-test',
  })
})

test('parseDeepCodeArgs recognizes prefix-preserving compact command', () => {
  const parsed = parseDeepCodeArgs([
    '--compact',
    'summarize',
    'this',
    'tail',
  ])

  assert.equal(parsed.command, 'compact')
  assert.deepEqual(parsed.promptArgs, ['summarize', 'this', 'tail'])
})

test('applyDeepCodeCliEnvOverrides keeps CLI values above inherited env', () => {
  const env = applyDeepCodeCliEnvOverrides(
    {
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_THINKING: 'enabled',
    },
    {
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_THINKING: 'disabled',
    },
  )

  assert.equal(env.DEEPSEEK_MODEL, 'deepseek-v4-flash')
  assert.equal(env.DEEPSEEK_THINKING, 'disabled')
})

test('createDeepSeekCacheStats accumulates last and total cache telemetry', () => {
  const first = createDeepSeekCacheStats(null, {
    prompt_cache_hit_tokens: 9,
    prompt_cache_miss_tokens: 1,
  }, { now: () => '2026-05-05T00:00:00.000Z' })
  const second = createDeepSeekCacheStats(first, {
    prompt_cache_hit_tokens: 30,
    prompt_cache_miss_tokens: 10,
  }, { now: () => '2026-05-05T00:01:00.000Z' })

  assert.deepEqual(second, {
    version: 1,
    requestCount: 2,
    totalPromptCacheHitTokens: 39,
    totalPromptCacheMissTokens: 11,
    totalPromptCacheHitRate: 0.78,
    lastPromptCacheHitTokens: 30,
    lastPromptCacheMissTokens: 10,
    lastPromptCacheHitRate: 0.75,
    updatedAt: '2026-05-05T00:01:00.000Z',
  })
})

test('createDeepSeekCacheStats records stable prefix diagnostics', async () => {
  const firstPrefix = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
  })
  const secondPrefix = await createDeepCodeStablePrefix({
    repoSummary: 'repo-b',
  })
  const first = createDeepSeekCacheStats(null, {
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 100,
  }, {
    now: () => '2026-05-05T00:00:00.000Z',
    stablePrefix: firstPrefix,
  })
  const second = createDeepSeekCacheStats(first, {
    prompt_cache_hit_tokens: 80,
    prompt_cache_miss_tokens: 20,
  }, {
    now: () => '2026-05-05T00:01:00.000Z',
    stablePrefix: secondPrefix,
  })

  assert.equal(first.lastStablePrefixHash, firstPrefix.prefixHash)
  assert.deepEqual(first.lastStablePrefixComponentHashes, firstPrefix.componentHashes)
  assert.equal(second.previousStablePrefixHash, firstPrefix.prefixHash)
  assert.deepEqual(second.previousStablePrefixComponentHashes, firstPrefix.componentHashes)
  assert.equal(second.lastStablePrefixHash, secondPrefix.prefixHash)
  assert.deepEqual(second.lastStablePrefixComponentHashes, secondPrefix.componentHashes)
})

test('formatDeepSeekCacheStatus renders persisted cache telemetry for status', () => {
  const formatted = formatDeepSeekCacheStatus({
    requestCount: 3,
    totalPromptCacheHitTokens: 120,
    totalPromptCacheMissTokens: 30,
    totalPromptCacheHitRate: 0.8,
    lastPromptCacheHitTokens: 40,
    lastPromptCacheMissTokens: 10,
    lastPromptCacheHitRate: 0.8,
    updatedAt: '2026-05-05T00:00:00.000Z',
  })

  assert.match(formatted, /Cache telemetry: last_hit=40 last_miss=10 last_hit_rate=80\.0%/)
  assert.match(formatted, /Cache telemetry: total_hit=120 total_miss=30 total_hit_rate=80\.0% requests=3/)
  assert.match(formatted, /Cache telemetry updated: 2026-05-05T00:00:00\.000Z/)
})

test('formatDeepSeekCacheStatus reports stable prefix miss diagnostics', async () => {
  const previousPrefix = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
  })
  const currentPrefix = await createDeepCodeStablePrefix({
    repoSummary: 'repo-b',
  })
  const changed = formatDeepSeekCacheStatus({
    requestCount: 1,
    lastStablePrefixHash: previousPrefix.prefixHash,
    lastStablePrefixComponentHashes: previousPrefix.componentHashes,
  }, {
    stablePrefix: currentPrefix,
  })
  const unchanged = formatDeepSeekCacheStatus({
    requestCount: 1,
    lastStablePrefixHash: currentPrefix.prefixHash,
    lastStablePrefixComponentHashes: currentPrefix.componentHashes,
  }, {
    stablePrefix: currentPrefix,
  })

  assert.match(
    changed,
    new RegExp(`Cache prefix: current=${currentPrefix.prefixHash} last=${previousPrefix.prefixHash} status=changed components=repoSummary`),
  )
  assert.match(
    unchanged,
    new RegExp(`Cache prefix: current=${currentPrefix.prefixHash} last=${currentPrefix.prefixHash} status=unchanged`),
  )
})

test('Deep Code status adapter shares CLI and TUI cache telemetry formatting', async () => {
  const {
    buildDeepCodeStatusReport,
    deepCodeStatusReportToProperties,
    formatDeepCodeStatus,
  } = await import('../src/deepcode/status.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-status-adapter-'))
  const statsPath = join(dir, 'stats.json')
  await writeFile(statsPath, JSON.stringify({
    version: 1,
    requestCount: 2,
    totalPromptCacheHitTokens: 90,
    totalPromptCacheMissTokens: 10,
    totalPromptCacheHitRate: 0.9,
    lastPromptCacheHitTokens: 9,
    lastPromptCacheMissTokens: 1,
    lastPromptCacheHitRate: 0.9,
    updatedAt: '2026-05-05T00:00:00.000Z',
  }))

  const report = await buildDeepCodeStatusReport({
    cwd: '/tmp/deepcode-workspace',
    env: {
      DEEPCODE_CACHE_STATS_PATH: statsPath,
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_SMALL_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_REASONING_EFFORT: 'max',
    },
    repoSummary: 'stable repo summary',
    volatileUserPrompt: 'first prompt',
  })
  const sameStablePrefix = await buildDeepCodeStatusReport({
    cwd: '/tmp/deepcode-workspace',
    env: {
      DEEPCODE_CACHE_STATS_PATH: statsPath,
      DEEPSEEK_API_KEY: 'sk-test',
    },
    repoSummary: 'stable repo summary',
    volatileUserPrompt: 'different prompt',
  })
  const formatted = formatDeepCodeStatus(report)
  const properties = deepCodeStatusReportToProperties(report)

  assert.equal(report.stablePrefix.prefixHash, sameStablePrefix.stablePrefix.prefixHash)
  assert.match(formatted, /Provider: DeepSeek native/)
  assert.match(formatted, /Model: deepseek-v4-pro/)
  assert.match(formatted, /Reasoning effort: max/)
  assert.match(formatted, /Cache telemetry: last_hit=9 last_miss=1 last_hit_rate=90\.0%/)
  assert.match(formatted, /Stable prefix hash: [A-Za-z0-9_-]+/)
  assert.equal(properties.find(item => item.label === 'Provider')?.value, 'DeepSeek native')
  assert.equal(properties.find(item => item.label === 'Model')?.value, 'deepseek-v4-pro')
  assert.equal(properties.find(item => item.label === 'Reasoning effort')?.value, 'max')
  assert.equal(properties.find(item => item.label === 'Cache hit rate')?.value, '90.0%')
  assert.equal(
    properties.find(item => item.label === 'Stable prefix hash')?.value,
    report.stablePrefix.prefixHash,
  )
})

test('resolveDeepSeekCacheStatsPath supports explicit disabled and configured paths', () => {
  assert.equal(resolveDeepSeekCacheStatsPath({
    env: { DEEPCODE_CACHE_STATS: 'disabled' },
    config: { cacheUserId: 'dc_workspace' },
    homeDir: '/tmp/home',
  }), null)
  assert.equal(resolveDeepSeekCacheStatsPath({
    env: { DEEPCODE_CACHE_STATS_PATH: '/tmp/deepcode-cache.json' },
    config: { cacheUserId: 'dc_workspace' },
    homeDir: '/tmp/home',
  }), '/tmp/deepcode-cache.json')
  assert.equal(resolveDeepSeekCacheStatsPath({
    env: {},
    config: { cacheUserId: 'dc/workspace' },
    homeDir: '/tmp/home',
  }), '/tmp/home/.deepcode/cache-stats/dc_workspace.json')
})

test('recordDeepSeekCacheUsage is best-effort when stats path cannot be written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-cache-unwritable-'))
  const blockingFile = join(dir, 'not-a-directory')
  await writeFile(blockingFile, 'x')

  const result = await recordDeepSeekCacheUsage({
    path: join(blockingFile, 'stats.json'),
    usage: {
      prompt_cache_hit_tokens: 1,
      prompt_cache_miss_tokens: 1,
    },
  })

  assert.equal(result, null)
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
  assert.equal(calculateDeepSeekRetryDelayMs({ retryAfterSeconds: 7 }, 0), 7000)
  assert.equal(calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100 }), 400)
})

test('streamDeepSeekQuery retries retryable HTTP failures before streaming', async () => {
  const delays = []
  let attempts = 0
  const events = []
  for await (const event of streamDeepSeekQuery({
    url: 'https://api.deepseek.com/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'deepseek-v4-pro', messages: [] },
    maxRetries: 1,
    sleep(ms) {
      delays.push(ms)
      return Promise.resolve()
    },
    async fetch() {
      attempts += 1
      if (attempts === 1) {
        return new Response('limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        })
      }
      return new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ]), { status: 200 })
    },
  })) {
    events.push(event)
  }

  assert.equal(attempts, 2)
  assert.deepEqual(delays, [0])
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'ok' },
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

test('createDeepSeekWarmupContext builds stable prefix hashes for cache warm-up', async () => {
  const first = await createDeepSeekWarmupContext({
    systemPrompt: ['fixed'],
    repoSummary: 'repo',
    tools: [
      {
        name: 'Write',
        description: 'Write a file',
        inputJSONSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      },
      {
        name: 'Read',
        description: 'Read a file',
        inputJSONSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
        },
      },
    ],
  })
  const second = await createDeepSeekWarmupContext({
    repoSummary: 'repo',
    systemPrompt: ['fixed'],
    tools: [
      {
        description: 'Read a file',
        name: 'Read',
        inputJSONSchema: {
          properties: { file_path: { type: 'string' } },
          type: 'object',
        },
      },
      {
        description: 'Write a file',
        name: 'Write',
        inputJSONSchema: {
          properties: { path: { type: 'string' } },
          type: 'object',
        },
      },
    ],
  })

  assert.equal(first.prefixHash, second.prefixHash)
  assert.deepEqual(first.stableTools.map(tool => tool.name), ['Read', 'Write'])
  assert.ok(first.systemPrompt.some(item => item.includes('Stable tool manifest')))
})

test('createDeepCodeStablePrefix ignores volatile prompts but changes on stable repo summary', async () => {
  const first = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: 'explain one file',
  })
  const second = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: 'modify a different file',
  })
  const changed = await createDeepCodeStablePrefix({
    repoSummary: 'repo-b',
  })

  assert.equal(first.prefixHash, second.prefixHash)
  assert.notEqual(first.prefixHash, changed.prefixHash)
  assert.ok(first.systemPrompt.some(item => item.includes('Stable repo summary')))
})

test('createDeepCodeStablePrefix exposes component hashes for cache miss diagnostics', async () => {
  const first = await createDeepCodeStablePrefix({
    systemPrompt: ['fixed'],
    repoSummary: 'repo-a',
  })
  const second = await createDeepCodeStablePrefix({
    systemPrompt: ['fixed'],
    repoSummary: 'repo-b',
  })

  assert.deepEqual(Object.keys(first.componentHashes).sort(), [
    'repoSummary',
    'skills',
    'stableHistory',
    'systemPrompt',
    'tools',
  ])
  assert.equal(first.componentHashes.systemPrompt, second.componentHashes.systemPrompt)
  assert.notEqual(first.componentHashes.repoSummary, second.componentHashes.repoSummary)
})

test('createDeepCodeStablePrefix sorts tool manifest for cache-stable requests', async () => {
  const writeTool = {
    name: 'Write',
    description: 'Write a file',
    inputJSONSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  }
  const readTool = {
    name: 'Read',
    description: 'Read a file',
    inputJSONSchema: {
      type: 'object',
      properties: { file_path: { type: 'string' } },
    },
  }

  const first = await createDeepCodeStablePrefix({
    tools: [writeTool, readTool],
  })
  const second = await createDeepCodeStablePrefix({
    tools: [readTool, writeTool],
  })

  assert.equal(first.prefixHash, second.prefixHash)
  assert.deepEqual(first.stableTools.map(tool => tool.name), ['Read', 'Write'])
})

test('createDeepCodeStablePrefix includes strict tool profile in cache-stable manifests', async () => {
  const tool = {
    name: 'Read',
    description: 'Read a file',
    inputJSONSchema: {
      type: 'object',
      properties: { file_path: { type: 'string' } },
      required: ['file_path'],
      additionalProperties: false,
    },
  }

  const flexible = await createDeepCodeStablePrefix({
    tools: [tool],
    toolSchemaOptions: { strict: false },
  })
  const strict = await createDeepCodeStablePrefix({
    tools: [tool],
    toolSchemaOptions: { strict: true },
  })

  assert.notEqual(flexible.prefixHash, strict.prefixHash)
  assert.equal('strict' in flexible.stableTools[0], false)
  assert.equal(strict.stableTools[0].strict, true)
})

test('createDeepCodeStablePrefix sorts skill manifest for cache-stable requests', async () => {
  const first = await createDeepCodeStablePrefix({
    skills: [
      { name: 'write-tests', description: 'Write tests', path: 'skills/tests' },
      { name: 'debug', description: 'Debug failures', path: 'skills/debug' },
    ],
  })
  const second = await createDeepCodeStablePrefix({
    skills: [
      { name: 'debug', description: 'Debug failures', path: 'skills/debug' },
      { name: 'write-tests', description: 'Write tests', path: 'skills/tests' },
    ],
  })

  assert.equal(first.prefixHash, second.prefixHash)
  assert.deepEqual(first.stableSkills.map(skill => skill.name), [
    'debug',
    'write-tests',
  ])
})

test('createDeepCodeStableTools exposes real local tools for stable prefix manifests', async () => {
  const tools = createDeepCodeStableTools({ cwd: '/tmp/workspace' })
  const stable = await createDeepCodeStablePrefix({ tools })

  assert.deepEqual(tools.map(tool => tool.name), ['Read', 'Edit', 'Bash'])
  assert.deepEqual(stable.stableTools.map(tool => tool.name), ['Bash', 'Edit', 'Read'])
  assert.ok(stable.systemPrompt.some(item => item.includes('Stable tool manifest')))
  assert.equal(
    stable.stableTools.find(tool => tool.name === 'Read').parameters.properties.file_path.type,
    'string',
  )
})

test('createDeepCodeStablePrefix snapshots full CLI tool registry style schemas for DeepSeek', async () => {
  const fullRegistryStyleTools = [
    {
      name: 'TodoWrite',
      description: 'Create and update structured task lists',
      inputJSONSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', minLength: 1 },
                id: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
    {
      name: 'Read',
      description: 'Read a file from the workspace',
      inputJSONSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
    {
      name: 'Grep',
      description: 'Search file contents',
      inputJSONSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'Bash',
      description: 'Run a shell command',
      inputJSONSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', maxLength: 20000 },
          description: { type: 'string' },
        },
        required: ['command'],
      },
    },
    {
      name: 'Glob',
      description: 'Find files by glob pattern',
      inputJSONSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'Edit',
      description: 'Replace text in a file',
      inputJSONSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string', minLength: 1 },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  ]

  const flexible = await createDeepCodeStablePrefix({
    tools: fullRegistryStyleTools,
  })
  const reordered = await createDeepCodeStablePrefix({
    tools: [...fullRegistryStyleTools].reverse(),
  })
  const strict = await createDeepCodeStablePrefix({
    tools: fullRegistryStyleTools,
    toolSchemaOptions: { strict: true },
  })

  assert.equal(flexible.prefixHash, reordered.prefixHash)
  assert.deepEqual(
    flexible.stableTools.map(tool => tool.name),
    ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'TodoWrite'],
  )
  assert.equal(
    flexible.stableTools.find(tool => tool.name === 'Bash').parameters.properties.command.maxLength,
    20000,
  )
  assert.equal(
    flexible.stableTools.find(tool => tool.name === 'TodoWrite').parameters.properties.todos.maxItems,
    100,
  )
  assert.equal(
    strict.stableTools.every(tool => tool.strict === true),
    true,
  )
  assert.notEqual(flexible.prefixHash, strict.prefixHash)
  assert.equal(
    'maxLength' in strict.stableTools.find(tool => tool.name === 'Bash').parameters.properties.command,
    false,
  )
  assert.equal(
    'maxItems' in strict.stableTools.find(tool => tool.name === 'TodoWrite').parameters.properties.todos,
    false,
  )
  assert.deepEqual(
    strict.stableTools
      .find(tool => tool.name === 'TodoWrite')
      .parameters.properties.todos.items.required,
    ['content', 'id', 'status'],
  )
})

test('createDeepSeekWarmupContext uses the shared Deep Code stable prefix builder', async () => {
  const stable = await createDeepCodeStablePrefix({ repoSummary: 'repo-a' })
  const warmup = await createDeepSeekWarmupContext({ repoSummary: 'repo-a' })

  assert.equal(warmup.prefixHash, stable.prefixHash)
  assert.deepEqual(warmup.systemPrompt, stable.systemPrompt)
})

test('formatDeepCodePrefixStatus renders stable prefix hash', async () => {
  const stable = await createDeepCodeStablePrefix({ repoSummary: 'repo-a' })

  assert.equal(
    formatDeepCodePrefixStatus(stable),
    `Stable prefix hash: ${stable.prefixHash}`,
  )
})

test('compactDeepCodeConversation preserves stable prefix and summarizes only volatile tail', async () => {
  const stablePrefix = await createDeepCodeStablePrefix({
    repoSummary: 'stable repo summary',
  })
  const requests = []
  const result = await compactDeepCodeConversation({
    stablePrefix,
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_SMALL_MODEL: 'deepseek-v4-flash',
    },
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield {
            type: 'content_delta',
            text: 'User asked for repo inspection. Assistant explained cache behavior.',
          }
          yield { type: 'finish', finishReason: 'stop' }
          yield {
            type: 'usage',
            usage: {
              prompt_cache_hit_tokens: 64,
              prompt_cache_miss_tokens: 16,
            },
          }
        })()
      },
    },
    messages: [
      { role: 'user', content: 'inspect the repo' },
      { role: 'assistant', content: 'cache details' },
    ],
  })

  assert.equal(result.prefixBeforeHash, stablePrefix.prefixHash)
  assert.equal(result.prefixAfterHash, stablePrefix.prefixHash)
  assert.equal(requests[0].body.model, 'deepseek-v4-flash')
  assert.deepEqual(
    requests[0].body.messages[0],
    { role: 'system', content: stablePrefix.systemPrompt.join('\n\n') },
  )
  assert.match(requests[0].body.messages.at(-1).content, /inspect the repo/)
  assert.match(result.summary, /repo inspection/)
  assert.deepEqual(result.messages, [
    {
      role: 'user',
      content: 'Compacted conversation summary:\nUser asked for repo inspection. Assistant explained cache behavior.',
    },
  ])
  assert.equal(result.cacheDiagnostics.promptCacheHitRate, 0.8)
})

test('formatDeepCodeCompactResult renders prefix hash and cache diagnostics', () => {
  const formatted = formatDeepCodeCompactResult({
    prefixBeforeHash: 'abc',
    prefixAfterHash: 'abc',
    summary: 'short summary',
    messages: [{ role: 'user', content: 'Compacted conversation summary:\nshort summary' }],
    cacheDiagnostics: {
      promptCacheHitTokens: 8,
      promptCacheMissTokens: 2,
      promptCacheHitRate: 0.8,
    },
  })

  assert.match(formatted, /DeepSeek prefix-preserving compact/)
  assert.match(formatted, /Stable prefix hash: abc -> abc/)
  assert.match(formatted, /Cache: hit=8 miss=2 hit_rate=80\.0%/)
})

test('warmDeepSeekCache sends low-output warm-up requests and reports cache telemetry', async () => {
  const requests = []
  const result = await warmDeepSeekCache({
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    cwd: '/tmp/workspace',
    systemPrompt: ['fixed'],
    repoSummary: 'repo',
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'ok' }
          yield { type: 'finish', finishReason: 'stop' }
          yield {
            type: 'usage',
            usage: {
              prompt_cache_hit_tokens: 9,
              prompt_cache_miss_tokens: 1,
            },
          }
        })()
      },
    },
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.max_tokens, 8)
  assert.equal(requests[0].body.thinking.type, 'disabled')
  assert.equal(result.cacheDiagnostics.promptCacheHitRate, 0.9)
  assert.match(formatDeepSeekWarmupResult(result), /hit=9 miss=1/)
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

test('createDeepSeekCallModel forwards query runtime controls to DeepSeek provider', async () => {
  const requests = []
  const callModel = createDeepSeekCallModel({
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
        })()
      },
    },
  })
  const controller = new AbortController()
  const fetchOverride = async () => new Response('')

  for await (const _ of callModel({
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: ['You are Deep Code.'],
    tools: [],
    signal: controller.signal,
    options: {
      model: 'claude-sonnet-4-5',
      effortValue: 'xhigh',
      fetchOverride,
    },
  })) {
    // Drain the stream.
  }

  assert.equal(requests[0].model, process.env.DEEPSEEK_MODEL ?? process.env.DEEPCODE_MODEL)
  assert.equal(requests[0].reasoningEffort, 'max')
  assert.equal(requests[0].signal, controller.signal)
  assert.equal(requests[0].fetch, fetchOverride)
})

test('createDeepSeekCallModel records DeepSeek cache telemetry for full CLI and TUI paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-query-cache-'))
  const statsPath = join(cwd, 'cache-stats.json')
  const previousStatsPath = process.env.DEEPCODE_CACHE_STATS_PATH
  process.env.DEEPCODE_CACHE_STATS_PATH = statsPath

  try {
    const callModel = createDeepSeekCallModel({
      provider: {
        streamQuery() {
          return (async function* stream() {
            yield { type: 'content_delta', text: 'done' }
            yield { type: 'finish', finishReason: 'stop' }
            yield {
              type: 'usage',
              usage: {
                prompt_cache_hit_tokens: 8,
                prompt_cache_miss_tokens: 2,
              },
            }
          })()
        },
      },
      uuid: () => 'cache-test',
    })

    for await (const _ of callModel({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: ['You are Deep Code.'],
      tools: [],
      signal: new AbortController().signal,
    })) {
      // Drain the response stream.
    }

    const stats = JSON.parse(await readFile(statsPath, 'utf8'))
    assert.equal(stats.lastPromptCacheHitTokens, 8)
    assert.equal(stats.lastPromptCacheMissTokens, 2)
    assert.equal(stats.lastPromptCacheHitRate, 0.8)
    assert.match(stats.lastStablePrefixHash, /^[A-Za-z0-9_-]+$/)
  } finally {
    if (previousStatsPath === undefined) {
      delete process.env.DEEPCODE_CACHE_STATS_PATH
    } else {
      process.env.DEEPCODE_CACHE_STATS_PATH = previousStatsPath
    }
  }
})

test('createDeepSeekCallModel prepends a stable real-tool prefix using query permissions', async () => {
  const requests = []
  const callModel = createDeepSeekCallModel({
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
        })()
      },
    },
  })
  const tools = [
    {
      name: 'WriteFile',
      inputJSONSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
      async prompt({ getToolPermissionContext, tools: promptTools }) {
        const permissionContext = await getToolPermissionContext()
        return `Write with mode=${permissionContext.mode}; tools=${promptTools.map(tool => tool.name).join(',')}`
      },
    },
    {
      name: 'ReadFile',
      description: 'Read a workspace file',
      inputJSONSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  ]

  for await (const _ of callModel({
    messages: [{ role: 'user', content: 'inspect files' }],
    systemPrompt: ['You are Deep Code.'],
    tools,
    signal: new AbortController().signal,
    options: {
      model: 'deepseek-v4-pro',
      getToolPermissionContext: async () => ({ mode: 'bypassPermissions' }),
      agents: {},
      allowedAgentTypes: [],
    },
  })) {
    // Drain the stream.
  }

  assert.equal(requests.length, 1)
  assert.match(
    requests[0].systemPrompt.join('\n\n'),
    /Stable tool manifest:/,
  )
  assert.deepEqual(
    requests[0].stablePrefix.stableTools.map(tool => tool.name),
    ['ReadFile', 'WriteFile'],
  )
  assert.match(
    requests[0].stablePrefix.stableTools.find(tool => tool.name === 'WriteFile').description,
    /mode=bypassPermissions; tools=WriteFile,ReadFile/,
  )
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

test('resolveDeepSeekReasoningEffort maps Claude Code effort levels to DeepSeek', () => {
  assert.equal(resolveDeepSeekReasoningEffort('low'), 'high')
  assert.equal(resolveDeepSeekReasoningEffort('medium'), 'high')
  assert.equal(resolveDeepSeekReasoningEffort('high'), 'high')
  assert.equal(resolveDeepSeekReasoningEffort('max'), 'max')
  assert.equal(resolveDeepSeekReasoningEffort('xhigh'), 'max')
  assert.equal(resolveDeepSeekReasoningEffort(undefined), undefined)
})

test('createDeepSeekDoctorReport validates DeepSeek-native request shape offline', async () => {
  const report = await createDeepSeekDoctorReport({
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    cwd: '/tmp/workspace',
    live: false,
  })

  assert.equal(hasFailingDoctorChecks(report), false)
  assert.equal(report.summary.skip, 1)
  assert.equal(report.config.provider, 'deepseek')
  assert.equal(report.config.cacheUserId, 'workspace-1')
  assert.match(formatDeepSeekDoctorReport(report), /Deep Code Doctor/)
  assert.ok(report.checks.some(check => check.id === 'request.noAnthropicFields'))
  assert.ok(report.checks.some(check => check.id === 'cache.diagnostics'))
})

test('createDeepSeekDoctorReport treats missing API key as skip in no-live mode', async () => {
  const report = await createDeepSeekDoctorReport({
    env: {},
    cwd: '/tmp/workspace-no-key',
    live: false,
  })

  assert.equal(hasFailingDoctorChecks(report), false)
  assert.ok(
    report.checks.some(
      check => check.id === 'config.apiKey' && check.status === 'skip',
    ),
  )
  assert.ok(
    report.checks.some(
      check => check.id === 'live.api' && check.status === 'skip',
    ),
  )
})

test('createDeepSeekDoctorReport validates live stream and cache telemetry with provider injection', async () => {
  const requests = []
  const report = await createDeepSeekDoctorReport({
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    cwd: '/tmp/workspace',
    live: true,
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'ok' }
          yield { type: 'finish', finishReason: 'stop' }
          yield {
            type: 'usage',
            usage: {
              prompt_cache_hit_tokens: 8,
              prompt_cache_miss_tokens: 2,
            },
          }
        })()
      },
    },
  })

  assert.equal(hasFailingDoctorChecks(report), false)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.thinking.type, 'disabled')
  assert.equal(requests[0].body.max_tokens, 16)
  assert.ok(report.checks.some(check => check.id === 'live.api' && check.status === 'pass'))
  assert.ok(report.checks.some(check => check.id === 'live.cacheTelemetry' && check.status === 'pass'))
})

test('runDeepSeekLocalToolChain executes Read -> Edit -> Bash -> Read through DeepSeek tool calls', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-toolchain-'))
  await writeFile(join(cwd, 'sample.txt'), 'alpha\n')
  const requests = []
  const result = await runDeepSeekLocalToolChain({
    prompt: 'Update sample.txt from alpha to beta, verify with bash, then read it.',
    cwd,
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_CACHE_USER_ID: 'workspace-1',
    },
    provider: {
      streamQuery(request) {
        requests.push(request)
        if (requests.length === 1) {
          return toolCallStream({
            id: 'call_read_1',
            name: 'Read',
            input: { file_path: 'sample.txt' },
            reasoning: 'Need to read the file first.',
          })
        }
        if (requests.length === 2) {
          return toolCallStream({
            id: 'call_edit_1',
            name: 'Edit',
            input: {
              file_path: 'sample.txt',
              old_string: 'alpha',
              new_string: 'beta',
            },
            reasoning: 'Now update the file.',
          })
        }
        if (requests.length === 3) {
          return toolCallStream({
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat sample.txt' },
            reasoning: 'Verify using a shell command.',
          })
        }
        if (requests.length === 4) {
          return toolCallStream({
            id: 'call_read_2',
            name: 'Read',
            input: { file_path: 'sample.txt' },
            reasoning: 'Read the final file contents.',
          })
        }
        return (async function* finalStream() {
          yield { type: 'content_delta', text: 'tool-e2e-ok' }
          yield { type: 'finish', finishReason: 'stop' }
          yield {
            type: 'usage',
            usage: {
              prompt_cache_hit_tokens: 32,
              prompt_cache_miss_tokens: 8,
            },
          }
        })()
      },
    },
  })

  assert.equal(result.content, 'tool-e2e-ok')
  assert.equal(await readFile(join(cwd, 'sample.txt'), 'utf8'), 'beta\n')
  assert.equal(requests.length, 5)
  assert.deepEqual(requests[0].body.tools.map(tool => tool.function.name), [
    'Bash',
    'Edit',
    'Read',
  ])
  assert.equal(requests[1].body.messages.at(-2).reasoning_content, 'Need to read the file first.')
  assert.equal(requests[4].body.messages.at(-1).role, 'tool')
  assert.equal(result.cacheDiagnostics.promptCacheHitRate, 0.8)
})

test('runDeepSeekLocalToolChain uses real tools in both stable prefix and DeepSeek request body', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-stable-tools-'))
  await writeFile(join(cwd, 'sample.txt'), 'alpha\n')
  const requests = []

  const result = await runDeepSeekLocalToolChain({
    cwd,
    prompt: 'Read sample.txt and answer.',
    provider: {
      streamQuery(request) {
        requests.push(request)
        return (async function* stream() {
          yield { type: 'content_delta', text: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
        })()
      },
    },
  })

  assert.equal(result.content, 'done')
  assert.deepEqual(
    result.stablePrefix.stableTools.map(tool => tool.name),
    ['Bash', 'Edit', 'Read'],
  )
  assert.equal(requests.length, 1)
  assert.deepEqual(
    requests[0].body.tools.map(tool => tool.function.name),
    ['Bash', 'Edit', 'Read'],
  )
  assert.match(
    requests[0].body.messages[0].content,
    /Stable tool manifest:/,
  )
  assert.match(
    requests[0].body.messages[0].content,
    /"name":"Read"/,
  )
})

test('createDeepSeekLocalTools rejects paths outside cwd and unsafe bash commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-toolchain-'))
  const tools = createDeepSeekLocalTools({ cwd })
  const read = tools.find(tool => tool.name === 'Read')
  const bash = tools.find(tool => tool.name === 'Bash')

  await assert.rejects(
    () => read.execute({ file_path: '../outside.txt' }, { cwd }),
    /outside workspace/,
  )
  await assert.rejects(
    () => bash.execute({ command: 'rm -rf sample.txt' }, { cwd }),
    /not allowed/,
  )
})

function sseBody(lines) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })
}

function toolCallStream({ id, name, input, reasoning }) {
  return (async function* stream() {
    yield { type: 'reasoning_delta', text: reasoning }
    yield {
      type: 'tool_call_delta',
      index: 0,
      id,
      name,
      argumentsDelta: JSON.stringify(input),
      finishReason: 'tool_calls',
    }
  })()
}
