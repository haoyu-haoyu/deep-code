import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { atomicWriteFile } from '../src/utils/atomicWrite.mjs'
import { omitUndefined } from '../src/utils/omitUndefined.mjs'
import { byteCompare } from '../src/cache/byte-order.mjs'
import { computeHighlightSpans } from '../src/utils/highlightSpans.mjs'
import { parseAgentMetadata } from '../src/utils/agentMetadata.mjs'
import { withCronFileLock } from '../src/utils/cronFileStore.mjs'
import { finalizePendingHooks } from '../src/utils/hooks/finalizePendingHooks.mjs'
import { formatFileSize } from '../src/utils/fileSize.mjs'
import { shouldUseColor } from '../src/deepcode/colorSupport.mjs'
import { formatDeepCodeWelcome } from '../src/deepcode/welcome.mjs'
import { displayWidth, truncateToWidth } from '../src/deepcode/displayWidth.mjs'
import { abortableDelay } from '../src/utils/abortableDelay.mjs'
import {
  extractAtMentionedFiles,
  extractMcpResourceMentions,
  parseAtMentionedFileLines,
} from '../src/utils/atMentionParsing.mjs'
import {
  computeWheelStep,
  initWheelAccel,
  readScrollSpeedBase,
} from '../src/components/wheelAccel.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import {
  readStdinWithTimeout,
  STDIN_PEEK_TIMEOUT_MS,
} from '../src/deepcode/stdin.mjs'
import { relativeNamespace } from '../src/utils/plugins/commandNamespace.mjs'
import {
  formatDeepSeekLoginResult,
  formatDeepSeekSetupAbort,
} from '../src/commands/login/loginResult.mjs'

import {
  buildDeepSeekRequest,
  calculateDeepSeekRetryDelayMs,
  collectDeepSeekStreamEvents,
  createDeepSeekWarmupContext,
  createDeepSeekCacheDiagnostics,
  createDeepSeekProvider,
  createDeepSeekCacheUserId,
  createDeepSeekPrefixHash,
  deepSeekApiErrorHint,
  DEEPSEEK_FINISH_ACTIONS,
  formatDeepSeekWarmupResult,
  mapMessagesToDeepSeek,
  mapDeepSeekFinishReason,
  mapDeepSeekHttpError,
  parseDeepSeekSSELines,
  runDeepSeekAgent,
  sanitizeSchemaForDeepSeekStrict,
  sleepMs,
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
  createDeepCodeMigrationDiagnostics,
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
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from '../src/deepcode/harness-config.mjs'
import {
  formatDeepCodeContextPolicy,
  resolveDeepCodeContextPolicy,
} from '../src/deepcode/context-policy.mjs'
import {
  buildDeepCodeHarnessRuntimeContext,
  clearDeepCodeHarnessAgentLifecycle,
  formatDeepCodeHarnessAgentLifecycle,
  formatDeepCodeHarnessRuntimeDecision,
  getLastDeepCodeHarnessAgentLifecycle,
  recordDeepCodeHarnessAgentLifecycle,
  recordDeepCodeHarnessRuntimeDecision,
  resolveDeepCodeDefaultSubagentType,
  resolveDeepCodeHarnessRuntime,
} from '../src/deepcode/harness-runtime.mjs'
import {
  createDeepCodeStableTools,
  createDeepSeekLocalTools,
  runDeepSeekLocalToolChain,
} from '../src/deepcode/local-toolchain.mjs'
import {
  runDeepCodeAgentRuntimeE2E,
} from '../src/deepcode/agent-runtime-e2e.mjs'
import {
  createDeepCodeStablePrefix,
  formatDeepCodePrefixStatus,
} from '../src/deepcode/stable-prefix.mjs'
import {
  compactDeepCodeConversation,
  formatDeepCodeCompactResult,
} from '../src/deepcode/compact.mjs'
import {
  createLocalInstructionPathPlan,
  createProjectInstructionPathPlan,
  isInstructionMemoryFilePath,
} from '../src/deepcode/instruction-paths.mjs'
import {
  getPreferredAgentMemoryDir,
  getPreferredAgentMemorySnapshotDir,
  isDeepCodeAgentMemoryPath,
} from '../src/deepcode/agent-memory-paths.mjs'
import {
  hasDeepSeekConfigFile,
  loadDeepSeekConfigFile,
  loadProviderConfigFile,
  mergeDeepSeekConfigPartial,
  mergeProviderConfigPartial,
  resolveDeepSeekConfigPath,
  saveDeepSeekConfigFile,
} from '../src/services/providers/deepseek-config-store.mjs'
import { resolveDeepSeekConfig } from '../src/services/providers/deepseek.mjs'
import { firstNonEmpty, parsePositiveIntOr } from '../src/utils/configValue.mjs'

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

test('Deep Code instruction path plans prefer DEEPCODE.md and .deepcode before Claude fallbacks', () => {
  const project = createProjectInstructionPathPlan('/repo')
  assert.deepEqual(project.primaryFiles, [
    join('/repo', 'DEEPCODE.md'),
    join('/repo', '.deepcode', 'DEEPCODE.md'),
  ])
  assert.equal(project.primaryRulesDir, join('/repo', '.deepcode', 'rules'))
  assert.deepEqual(project.legacyFiles, [
    join('/repo', 'CLAUDE.md'),
    join('/repo', '.claude', 'CLAUDE.md'),
  ])
  assert.equal(project.legacyRulesDir, join('/repo', '.claude', 'rules'))

  const local = createLocalInstructionPathPlan('/repo')
  assert.equal(local.primaryFile, join('/repo', 'DEEPCODE.local.md'))
  assert.equal(local.legacyFile, join('/repo', 'CLAUDE.local.md'))
})

test('Deep Code memory file detection includes DEEPCODE.md and .deepcode rules', () => {
  assert.equal(isInstructionMemoryFilePath(join('/repo', 'DEEPCODE.md')), true)
  assert.equal(isInstructionMemoryFilePath(join('/repo', 'DEEPCODE.local.md')), true)
  assert.equal(
    isInstructionMemoryFilePath(join('/repo', '.deepcode', 'rules', 'testing.md')),
    true,
  )
  assert.equal(isInstructionMemoryFilePath(join('/repo', 'CLAUDE.md')), true)
  assert.equal(
    isInstructionMemoryFilePath(join('/repo', '.claude', 'rules', 'testing.md')),
    true,
  )
  assert.equal(isInstructionMemoryFilePath(join('/repo', 'README.md')), false)
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

test('configValue.firstNonEmpty skips undefined/null/empty-or-whitespace, keeps the first real value', () => {
  assert.equal(firstNonEmpty(undefined, null, '', '  ', 'x'), 'x')
  assert.equal(firstNonEmpty('', 'a', 'b'), 'a') // empty string is treated as absent
  assert.equal(firstNonEmpty(undefined, undefined, 'DEFAULT'), 'DEFAULT') // unset → default
  assert.equal(firstNonEmpty('', '   '), undefined) // nothing real → undefined
  assert.equal(firstNonEmpty('first'), 'first')
})

test('configValue.parsePositiveIntOr coerces a positive integer else falls back', () => {
  assert.equal(parsePositiveIntOr('512', 1024), 512)
  assert.equal(parsePositiveIntOr(512, 1024), 512)
  assert.equal(parsePositiveIntOr(undefined, 1024), 1024) // unset → fallback
  assert.equal(parsePositiveIntOr('', 1024), 1024) // Number('') === 0 would have been wrong
  assert.equal(parsePositiveIntOr('lots', 1024), 1024) // NaN
  assert.equal(parsePositiveIntOr('0', 1024), 1024) // non-positive
  assert.equal(parsePositiveIntOr('-5', 1024), 1024)
  assert.equal(parsePositiveIntOr('3.5', 1024), 1024) // non-integer
})

test('resolveDeepSeekConfig treats an EMPTY model/baseUrl env var as unset (falls back to default)', () => {
  // an empty string is not nullish, so the old `?? DEFAULT` chain produced model:'' here —
  // a broken request. firstNonEmpty falls through to the default instead.
  const withEmpty = resolveDeepSeekConfig({
    env: { DEEPSEEK_MODEL: '', DEEPSEEK_SMALL_MODEL: '', DEEPSEEK_BASE_URL: '' },
    fileConfig: null,
  })
  assert.equal(withEmpty.model, 'deepseek-v4-pro')
  assert.equal(withEmpty.smallModel, 'deepseek-v4-flash')
  assert.equal(withEmpty.baseUrl, 'https://api.deepseek.com')
  // a real value still wins (behavior-identical)
  const withValue = resolveDeepSeekConfig({ env: { DEEPSEEK_MODEL: 'deepseek-v4-flash' }, fileConfig: null })
  assert.equal(withValue.model, 'deepseek-v4-flash')
  // the all-unset default path is unchanged (the cache-prefix default)
  const defaults = resolveDeepSeekConfig({ env: {}, fileConfig: null })
  assert.equal(defaults.model, 'deepseek-v4-pro')
  assert.equal(defaults.baseUrl, 'https://api.deepseek.com')
})

test('parseDeepCodeArgs rejects an empty =-form flag value', () => {
  // `--model=` (empty) is never meaningful and previously slipped through as DEEPSEEK_MODEL=''
  assert.throws(() => parseDeepCodeArgs(['--model=']), /requires a value/)
  // an explicit value (even a -prefixed one, which the space form forbids) is still accepted
  assert.deepEqual(
    parseDeepCodeArgs(['--model=deepseek-v4-flash']).envOverrides,
    { DEEPSEEK_MODEL: 'deepseek-v4-flash' },
  )
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

test('parseDeepCodeArgs recognizes DeepSeek Harness controls', () => {
  const parsed = parseDeepCodeArgs([
    '--harness',
    '--harness-mode=swarm',
    '--harness-max-agents',
    '3',
    '--max-context-tokens',
    '750000',
    '--prompt-pack',
    'deepseek-v1',
    '--strict-tools=safe',
  ])

  assert.equal(parsed.command, 'harness')
  assert.deepEqual(parsed.envOverrides, {
    DEEPCODE_HARNESS_MODE: 'swarm',
    DEEPCODE_HARNESS_MAX_AGENTS: '3',
    DEEPCODE_MAX_CONTEXT_TOKENS: '750000',
    DEEPCODE_PROMPT_PACK: 'deepseek-v1',
    DEEPCODE_STRICT_TOOLS: 'safe',
  })
})

test('resolveDeepCodeHarnessConfig applies safe DeepSeek defaults and env overrides', () => {
  const config = resolveDeepCodeHarnessConfig({
    DEEPCODE_HARNESS_MODE: 'on',
    DEEPCODE_HARNESS_MAX_AGENTS: '6',
    DEEPCODE_HARNESS_DEFAULT_SMALL_MODEL: 'deepseek-v4-flash-custom',
    DEEPCODE_HARNESS_COORDINATOR_MODEL: 'deepseek-v4-pro-custom',
    DEEPCODE_HARNESS_VERIFIER_MODEL: 'deepseek-v4-pro-verify',
    DEEPCODE_PROMPT_PACK: 'deepseek-v1',
    DEEPCODE_STRICT_TOOLS: 'safe',
  })

  assert.deepEqual(config, {
    mode: 'on',
    maxAgents: 6,
    defaultSmallModel: 'deepseek-v4-flash-custom',
    coordinatorModel: 'deepseek-v4-pro-custom',
    verifierModel: 'deepseek-v4-pro-verify',
    promptPack: 'deepseek-v1',
    strictTools: 'safe',
  })
  assert.match(formatDeepCodeHarnessStatus(config), /Harness mode: on/)
  assert.match(formatDeepCodeHarnessStatus(config), /Prompt pack: deepseek-v1/)
  assert.match(formatDeepCodeHarnessStatus(config), /Strict tools: safe/)
})

test('resolveDeepCodeContextPolicy configures DeepSeek v4 for 1M context and auto compact headroom', () => {
  const policy = resolveDeepCodeContextPolicy({
    env: {},
    model: 'deepseek-v4-pro',
  })
  const flash = resolveDeepCodeContextPolicy({
    env: {},
    model: 'deepseek-v4-flash',
  })
  const override = resolveDeepCodeContextPolicy({
    env: { DEEPCODE_MAX_CONTEXT_TOKENS: '500000' },
    model: 'deepseek-v4-pro',
  })
  const disabled = resolveDeepCodeContextPolicy({
    env: { DEEPCODE_DISABLE_1M_CONTEXT: '1' },
    model: 'deepseek-v4-pro',
  })
  const formatted = formatDeepCodeContextPolicy(policy)

  assert.equal(policy.contextWindowTokens, 1_000_000)
  assert.equal(policy.effectiveContextWindowTokens, 980_000)
  assert.equal(policy.autoCompactThresholdTokens, 967_000)
  assert.equal(policy.maxOutputTokens.default, 64_000)
  assert.equal(policy.maxOutputTokens.upperLimit, 384_000)
  assert.equal(policy.autoCompactEnabled, true)
  assert.equal(flash.contextWindowTokens, 1_000_000)
  assert.equal(override.contextWindowTokens, 500_000)
  assert.equal(override.autoCompactThresholdTokens, 467_000)
  assert.equal(disabled.contextWindowTokens, 200_000)
  assert.match(formatted, /Context window: 1000000/)
  assert.match(formatted, /Effective context window: 980000/)
  assert.match(formatted, /Auto compact: enabled/)
  assert.match(formatted, /Auto compact threshold: 967000/)
  assert.doesNotMatch(formatted, /Claude|Anthropic/)
})

test('resolveDeepCodeHarnessRuntime applies DeepSeek Harness mode decisions', () => {
  const off = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'off' },
    prompt: 'fix failing tests across the full CLI and TUI',
  })
  const on = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'on' },
    prompt: 'reply hello',
  })
  const swarm = resolveDeepCodeHarnessRuntime({
    env: {
      DEEPCODE_HARNESS_MODE: 'swarm',
      DEEPCODE_HARNESS_MAX_AGENTS: '3',
    },
    prompt: 'coordinate a multi-module migration',
  })
  const simpleAuto = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Reply exactly: hello',
  })
  const complexAuto = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Fix failing tests across the full CLI and TUI, including cache and tool permission regressions.',
  })
  const nested = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'on' },
    prompt: 'fix a file',
    isMainAgent: false,
  })

  assert.equal(off.state, 'inactive')
  assert.equal(on.state, 'harness')
  assert.equal(swarm.state, 'swarm')
  assert.equal(swarm.maxAgents, 3)
  assert.equal(simpleAuto.state, 'inactive')
  assert.equal(complexAuto.state, 'harness')
  assert.ok(complexAuto.reasons.includes('tests'))
  assert.ok(complexAuto.reasons.includes('tooling'))
  assert.equal(complexAuto.recommendedProfile, 'worker')
  assert.equal(complexAuto.delegationPolicy, 'selective-specialists')
  assert.equal(nested.state, 'inactive')
  assert.equal(nested.reason, 'subagent-nesting-disabled')
  assert.equal(nested.recommendedProfile, 'general-purpose')
  assert.equal(nested.delegationPolicy, 'single-agent')
})

test('resolveDeepCodeHarnessRuntime keeps auto mode conservative', () => {
  const weakTestsOnly = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Run the tests and tell me what happened.',
  })
  const weakImplementationOnly = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Implement this one-line copy change.',
  })
  const strongFailingTests = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Fix failing tests in the CLI.',
  })
  const strongSubagents = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Use subagents to inspect the permissions and cache behavior.',
  })
  const combinedSignals = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Implement cache handling across the full CLI and TUI.',
  })

  assert.equal(weakTestsOnly.state, 'inactive')
  assert.equal(weakTestsOnly.reason, 'auto-simple-task')
  assert.equal(weakImplementationOnly.state, 'inactive')
  assert.equal(strongFailingTests.state, 'harness')
  assert.ok(strongFailingTests.reasons.includes('fix-failing-tests'))
  assert.equal(strongSubagents.state, 'harness')
  assert.ok(strongSubagents.reasons.includes('agent-orchestration'))
  assert.equal(combinedSignals.state, 'harness')
  assert.ok(combinedSignals.reasons.includes('cross-module'))
  assert.ok(combinedSignals.reasons.includes('implementation'))
})

test('buildDeepCodeHarnessRuntimeContext is dynamic and cache-safe', () => {
  const decision = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'swarm' },
    prompt: 'implement a cross-module orchestrator and verify it',
  })
  const context = buildDeepCodeHarnessRuntimeContext(decision)

  assert.match(context, /Deep Code Harness runtime/)
  assert.match(context, /profiles: explorer, worker, verification, summarizer/)
  assert.match(context, /Max agents: 4/)
  assert.match(context, /Recommended default Agent profile: worker/)
  assert.match(context, /Delegation policy: team-lanes/)
  assert.doesNotMatch(context, /Claude|Anthropic/)
  assert.doesNotMatch(context, /session[_ -]?id|request[_ -]?id|cache hit|cache miss|timestamp/i)
})

test('DeepSeek Harness runtime context stays out of stable prefix hash', async () => {
  const decision = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'on' },
    prompt: 'Fix failing tests across the full CLI and TUI.',
  })
  const harnessRuntimeContext = buildDeepCodeHarnessRuntimeContext(decision)
  const first = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: `Current user prompt A\n\n${harnessRuntimeContext}`,
  })
  const second = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: 'Current user prompt B without Harness context',
  })
  const changedTools = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    tools: [
      {
        name: 'Read',
        inputJSONSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ],
  })

  assert.equal(first.prefixHash, second.prefixHash)
  assert.notEqual(first.prefixHash, changedTools.prefixHash)
})

test('resolveDeepCodeDefaultSubagentType follows active Harness decisions', () => {
  const activeRuntimeDecision = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'auto' },
    prompt: 'Fix failing tests across the full CLI and TUI',
  })

  assert.equal(
    resolveDeepCodeDefaultSubagentType({
      env: { DEEPCODE_HARNESS_MODE: 'on' },
      prompt: 'implement the focused fix',
    }),
    'worker',
  )
  assert.equal(
    resolveDeepCodeDefaultSubagentType({
      env: { DEEPCODE_HARNESS_MODE: 'off' },
      prompt: 'implement the focused fix',
    }),
    'general-purpose',
  )
  assert.equal(
    resolveDeepCodeDefaultSubagentType({
      env: { DEEPCODE_HARNESS_MODE: 'auto' },
      prompt: 'Inspect one file.',
      isMainAgent: true,
      runtimeDecision: activeRuntimeDecision,
    }),
    'worker',
  )
  assert.equal(
    resolveDeepCodeDefaultSubagentType({
      env: { DEEPCODE_HARNESS_MODE: 'auto' },
      prompt: 'Inspect one file.',
      isMainAgent: false,
      runtimeDecision: activeRuntimeDecision,
    }),
    'general-purpose',
  )
  assert.match(
    formatDeepCodeHarnessRuntimeDecision(
      resolveDeepCodeHarnessRuntime({
        env: { DEEPCODE_HARNESS_MODE: 'auto' },
        prompt: 'Fix failing tests across the full CLI and TUI',
      }),
    ),
    /Runtime recommended profile: worker/,
  )
})

test('DeepSeek Harness records Agent lifecycle metadata without cache drift', async () => {
  clearDeepCodeHarnessAgentLifecycle()
  const runtimeDecision = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'on' },
    prompt: 'Fix failing tests across the full CLI and TUI',
  })

  recordDeepCodeHarnessAgentLifecycle({
    selectedProfile: 'worker',
    requestedProfile: undefined,
    selection: 'default',
    parentRuntimeDecision: runtimeDecision,
    permissionMode: 'default',
  })

  const lifecycle = getLastDeepCodeHarnessAgentLifecycle()
  const formatted = formatDeepCodeHarnessAgentLifecycle(lifecycle)
  const first = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: JSON.stringify(lifecycle),
  })
  const second = await createDeepCodeStablePrefix({
    repoSummary: 'repo-a',
    volatileUserPrompt: 'different prompt and lifecycle metadata',
  })

  assert.equal(lifecycle.selectedProfile, 'worker')
  assert.equal(lifecycle.selection, 'default')
  assert.equal(lifecycle.requestedProfile, 'omitted')
  assert.equal(lifecycle.parentRuntimeState, 'harness')
  assert.equal(lifecycle.recommendedProfile, 'worker')
  assert.equal(lifecycle.delegationPolicy, 'selective-specialists')
  assert.equal(first.prefixHash, second.prefixHash)
  assert.match(formatted, /Harness agent profile: worker/)
  assert.match(formatted, /Harness agent selection: default/)
  assert.match(formatted, /Harness agent requested profile: omitted/)
  assert.match(formatted, /Harness agent parent runtime: harness/)
  assert.match(formatted, /Harness agent delegation policy: selective-specialists/)
  assert.doesNotMatch(formatted, /Claude|Anthropic/)
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

test('Deep Code agent memory paths prefer .deepcode with legacy fallback', () => {
  const cwd = '/repo'
  const memoryBaseDir = '/home/user/.deepcode'
  const legacyMemoryBaseDir = '/home/user/.claude'
  const legacyPaths = new Set([
    join(legacyMemoryBaseDir, 'agent-memory', 'reviewer'),
    join(cwd, '.claude', 'agent-memory', 'reviewer'),
    join(cwd, '.claude', 'agent-memory-local', 'reviewer'),
    join(cwd, '.claude', 'agent-memory-snapshots', 'reviewer'),
  ])
  const exists = path => legacyPaths.has(path)

  assert.equal(
    getPreferredAgentMemoryDir({
      agentType: 'reviewer',
      scope: 'user',
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
      exists,
    }),
    join(legacyMemoryBaseDir, 'agent-memory', 'reviewer') + '/',
  )
  assert.equal(
    getPreferredAgentMemoryDir({
      agentType: 'reviewer',
      scope: 'project',
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
      exists,
    }),
    join(cwd, '.claude', 'agent-memory', 'reviewer') + '/',
  )
  assert.equal(
    getPreferredAgentMemoryDir({
      agentType: 'reviewer',
      scope: 'local',
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
      exists,
    }),
    join(cwd, '.claude', 'agent-memory-local', 'reviewer') + '/',
  )
  assert.equal(
    getPreferredAgentMemorySnapshotDir({
      agentType: 'reviewer',
      cwd,
      exists,
    }),
    join(cwd, '.claude', 'agent-memory-snapshots', 'reviewer'),
  )

  assert.equal(
    getPreferredAgentMemoryDir({
      agentType: 'reviewer',
      scope: 'project',
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
      exists: () => false,
    }),
    join(cwd, '.deepcode', 'agent-memory', 'reviewer') + '/',
  )
  assert.equal(
    getPreferredAgentMemoryDir({
      agentType: 'plugin:reviewer',
      scope: 'local',
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
      exists: () => false,
    }),
    join(cwd, '.deepcode', 'agent-memory-local', 'plugin-reviewer') + '/',
  )
  assert.equal(
    isDeepCodeAgentMemoryPath({
      absolutePath: join(cwd, '.deepcode', 'agent-memory', 'reviewer', 'MEMORY.md'),
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
    }),
    true,
  )
  assert.equal(
    isDeepCodeAgentMemoryPath({
      absolutePath: join(cwd, '.claude', 'agent-memory-local', 'reviewer', 'MEMORY.md'),
      cwd,
      memoryBaseDir,
      legacyMemoryBaseDir,
    }),
    true,
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

  const runtimeDecision = resolveDeepCodeHarnessRuntime({
    env: { DEEPCODE_HARNESS_MODE: 'on' },
    prompt: 'Fix failing tests across the full CLI and TUI',
  })
  recordDeepCodeHarnessRuntimeDecision(runtimeDecision)
  recordDeepCodeHarnessAgentLifecycle({
    selectedProfile: 'worker',
    requestedProfile: undefined,
    selection: 'default',
    parentRuntimeDecision: runtimeDecision,
    permissionMode: 'default',
  })

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
  assert.match(formatted, /Context window: 1000000/)
  assert.match(formatted, /Auto compact threshold: 967000/)
  assert.match(formatted, /Reasoning effort: max/)
  assert.match(formatted, /Runtime recommended profile: worker/)
  assert.match(formatted, /Runtime delegation policy: selective-specialists/)
  assert.match(formatted, /Harness agent profile: worker/)
  assert.match(formatted, /Harness agent selection: default/)
  assert.match(formatted, /Cache telemetry: last_hit=9 last_miss=1 last_hit_rate=90\.0%/)
  assert.match(formatted, /Stable prefix hash: [A-Za-z0-9_-]+/)
  assert.equal(properties.find(item => item.label === 'Provider')?.value, 'DeepSeek native')
  assert.equal(properties.find(item => item.label === 'Model')?.value, 'deepseek-v4-pro')
  assert.equal(properties.find(item => item.label === 'Context window')?.value, '1000000')
  assert.equal(properties.find(item => item.label === 'Auto compact threshold')?.value, '967000')
  assert.equal(properties.find(item => item.label === 'Reasoning effort')?.value, 'max')
  assert.equal(properties.find(item => item.label === 'Harness recommended profile')?.value, 'worker')
  assert.equal(properties.find(item => item.label === 'Harness delegation policy')?.value, 'selective-specialists')
  assert.equal(properties.find(item => item.label === 'Harness agent profile')?.value, 'worker')
  assert.equal(properties.find(item => item.label === 'Harness agent selection')?.value, 'default')
  assert.equal(properties.find(item => item.label === 'Harness agent delegation policy')?.value, 'selective-specialists')
  assert.equal(properties.find(item => item.label === 'Cache hit rate')?.value, '90.0%')
  assert.equal(properties.find(item => item.label === 'Cache total hit/miss')?.value, '90/10')
  assert.equal(
    properties.find(item => item.label === 'Cache telemetry updated')?.value,
    '2026-05-05T00:00:00.000Z',
  )
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

test('recordDeepSeekCacheUsage serializes concurrent writes to the same path (no lost update)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-cache-race-'))
  const path = join(dir, 'stats.json')

  // Fire N record calls at the SAME path concurrently. Without serialization
  // they all load the same (initial) stats before any write lands, so the
  // increments clobber each other and the final requestCount is far below N;
  // serialized, every increment is applied on top of the previous write.
  const N = 8
  await Promise.all(
    Array.from({ length: N }, () =>
      recordDeepSeekCacheUsage({
        path,
        usage: { prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 2 },
      }),
    ),
  )

  const stats = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stats.requestCount, N)
  assert.equal(stats.totalPromptCacheHitTokens, N)
  assert.equal(stats.totalPromptCacheMissTokens, N * 2)
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

test('sanitizeSchemaForDeepSeekStrict recurses into anyOf and $defs (untested branches)', () => {
  // anyOf: each member is sanitized independently — an object member is closed
  // (required + additionalProperties), a scalar member just drops unsupported keys.
  assert.deepEqual(
    sanitizeSchemaForDeepSeekStrict({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string', minLength: 2 } } },
        { type: 'string', maxLength: 5 },
      ],
    }),
    {
      anyOf: [
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
        { type: 'string' },
      ],
    },
  )

  // $defs: every def is recursed, a supported constraint (minimum) is kept, and the def
  // NAMES are sorted (Apple before Zebra) so the output is order-stable.
  const defs = sanitizeSchemaForDeepSeekStrict({
    $defs: {
      Zebra: { type: 'object', properties: { z: { type: 'integer', minimum: 0 } } },
      Apple: { type: 'string', minLength: 1 },
    },
  })
  assert.deepEqual(Object.keys(defs.$defs), ['Apple', 'Zebra'])
  assert.deepEqual(defs, {
    $defs: {
      Apple: { type: 'string' },
      Zebra: {
        type: 'object',
        properties: { z: { type: 'integer', minimum: 0 } },
        required: ['z'],
        additionalProperties: false,
      },
    },
  })
})

test('sanitizeSchemaForDeepSeekStrict is order-stable for the cache moat', () => {
  // The sanitized schema rides the DeepSeek cached prefix, so two inputs that differ only
  // in key insertion order must serialize to BYTE-IDENTICAL JSON (keys are sorted at every
  // level). This is what keeps the tool manifest from reordering across runs.
  const a = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: { b: { type: 'string' }, a: { type: 'number' } },
    description: 'x',
  })
  const b = sanitizeSchemaForDeepSeekStrict({
    description: 'x',
    properties: { a: { type: 'number' }, b: { type: 'string' } },
    type: 'object',
  })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('byteCompare orders by UTF-16 code unit, locale-independently, and never throws', () => {
  // total order: -1 / 0 / 1
  assert.equal(byteCompare('a', 'b'), -1)
  assert.equal(byteCompare('b', 'a'), 1)
  assert.equal(byteCompare('a', 'a'), 0)
  // CODE-UNIT, not locale: 'Z' (0x5A) sorts before 'a' (0x61). localeCompare would
  // typically put 'a' first — this is the property that keeps the cached prefix stable
  // across machines/ICU builds.
  assert.equal(byteCompare('Z', 'a'), -1)
  // lexicographic over the String() coercion (NOT numeric): '10' < '9' by first code unit
  assert.equal(byteCompare(10, 9), -1)
  // non-strings are coerced, never throw (null/undefined/objects)
  assert.equal(byteCompare(null, undefined), -1) // 'null' < 'undefined'
  assert.doesNotThrow(() => byteCompare({}, []))
  // antisymmetry on distinct inputs
  for (const [x, y] of [['apple', 'banana'], ['Tool', 'tool'], ['1', '2']]) {
    assert.equal(byteCompare(x, y), -byteCompare(y, x))
  }
})

test('computeHighlightSpans splits text into ordered runs, marking case-insensitive matches', () => {
  // the concatenated span text always reconstructs the input; highlighted runs are the exact
  // (case-insensitive) matches in left-to-right, non-overlapping order (the testable logic
  // behind highlightMatch's inverse-highlight rendering).
  assert.deepEqual(computeHighlightSpans('Hello World', 'o'), [
    { text: 'Hell', highlighted: false },
    { text: 'o', highlighted: true },
    { text: ' W', highlighted: false },
    { text: 'o', highlighted: true },
    { text: 'rld', highlighted: false },
  ])
  // case-insensitive: 'bc' matches both 'bc' and 'BC', preserving original casing
  assert.deepEqual(computeHighlightSpans('abcABC', 'bc'), [
    { text: 'a', highlighted: false },
    { text: 'bc', highlighted: true },
    { text: 'A', highlighted: false },
    { text: 'BC', highlighted: true },
  ])
  // a match at the very start has no leading unhighlighted run
  assert.deepEqual(computeHighlightSpans('startX', 'start'), [
    { text: 'start', highlighted: true },
    { text: 'X', highlighted: false },
  ])
  // empty query / no match / empty text → a single unhighlighted whole-text run (the
  // renderer short-circuits this to the raw string, == the old `return text`)
  assert.deepEqual(computeHighlightSpans('abc', ''), [{ text: 'abc', highlighted: false }])
  assert.deepEqual(computeHighlightSpans('abc', 'zz'), [{ text: 'abc', highlighted: false }])
  assert.deepEqual(computeHighlightSpans('', 'x'), [{ text: '', highlighted: false }])
  // the spans always reconstruct the input verbatim
  for (const [t, q] of [['aXaXa', 'x'], ['MixedCase', 'c'], ['  pad  ', ' ']]) {
    assert.equal(computeHighlightSpans(t, q).map(s => s.text).join(''), t)
  }
})

test('parseAtMentionedFileLines normalizes an inverted #L range instead of a blank attachment', () => {
  assert.deepEqual(parseAtMentionedFileLines('file.txt#L10-20'), {
    filename: 'file.txt',
    lineStart: 10,
    lineEnd: 20,
  })
  // the fix: a fat-fingered inverted range is swapped to 10-20 (not lineStart=20,
  // lineEnd=10 -> a negative limit -> a silently-blank file attachment)
  assert.deepEqual(parseAtMentionedFileLines('file.txt#L20-10'), {
    filename: 'file.txt',
    lineStart: 10,
    lineEnd: 20,
  })
  // unchanged: single line, no range, non-line-range fragment, equal endpoints
  assert.deepEqual(parseAtMentionedFileLines('file.txt#L5'), {
    filename: 'file.txt',
    lineStart: 5,
    lineEnd: 5,
  })
  assert.deepEqual(parseAtMentionedFileLines('file.txt#L7-7'), {
    filename: 'file.txt',
    lineStart: 7,
    lineEnd: 7,
  })
  assert.deepEqual(parseAtMentionedFileLines('file.txt'), {
    filename: 'file.txt',
    lineStart: undefined,
    lineEnd: undefined,
  })
  assert.deepEqual(parseAtMentionedFileLines('file.txt#heading'), {
    filename: 'file.txt',
    lineStart: undefined,
    lineEnd: undefined,
  })
})

test('extractAtMentionedFiles matches Unicode/CJK paths and trims trailing prose punctuation', () => {
  // the fix: Unicode/CJK filenames are no longer dropped by the ASCII \b anchor
  assert.deepEqual(extractAtMentionedFiles('see @中文 please'), ['中文'])
  assert.deepEqual(extractAtMentionedFiles('read @项目/深度代码.txt now'), [
    '项目/深度代码.txt',
  ])

  // unchanged ASCII behavior, incl. the \b-equivalent trailing trim
  assert.deepEqual(extractAtMentionedFiles('check @file.txt please'), ['file.txt'])
  assert.deepEqual(extractAtMentionedFiles('see @config.json, then'), ['config.json'])
  assert.deepEqual(extractAtMentionedFiles('end of @config.json.'), ['config.json'])
  assert.deepEqual(extractAtMentionedFiles('dir @src/ here'), ['src'])
  assert.deepEqual(extractAtMentionedFiles('range @file.txt#L10-20 x'), [
    'file.txt#L10-20',
  ])
  assert.deepEqual(extractAtMentionedFiles('quoted @"my file.txt" ok'), [
    'my file.txt',
  ])
  assert.deepEqual(extractAtMentionedFiles('agent @"code-reviewer (agent)" x'), [])

  // MCP @server:uri still requires the colon, and now matches Unicode too
  assert.deepEqual(extractMcpResourceMentions('use @server1:resource/path x'), [
    'server1:resource/path',
  ])
  assert.deepEqual(extractMcpResourceMentions('cjk @服务器:资源 x'), ['服务器:资源'])
  assert.deepEqual(extractMcpResourceMentions('nocolon @plainfile x'), [])
})

test('abortableDelay rejects promptly when the signal aborts and resolves otherwise', async () => {
  // no signal -> just sleeps
  let slept = 0
  await abortableDelay(5, undefined, async () => {
    slept += 1
  })
  assert.equal(slept, 1)

  // already aborted -> throws AbortError, sleep never runs
  const pre = new AbortController()
  pre.abort()
  let preCalls = 0
  await assert.rejects(
    abortableDelay(
      5,
      pre.signal,
      async () => {
        preCalls += 1
      },
    ),
    e => e?.name === 'AbortError',
  )
  assert.equal(preCalls, 0)

  // aborts mid-wait -> throws AbortError
  const mid = new AbortController()
  await assert.rejects(
    abortableDelay(5, mid.signal, async () => {
      mid.abort()
    }),
    e => e?.name === 'AbortError',
  )

  // a live, never-aborted signal resolves normally
  const live = new AbortController()
  await abortableDelay(1, live.signal, async () => {})
})

test('sleepMs clears its timer and rejects on abort (no abandoned timer pinning the loop)', async () => {
  // injected timers: an abort must CLEAR the pending timer, not leave it to keep
  // the event loop alive for the full backoff
  let cleared = null
  const setTimer = () => 'timer-1'
  const clearTimer = id => {
    cleared = id
  }
  const ac = new AbortController()
  const pending = sleepMs(1000, ac.signal, { setTimer, clearTimer })
  ac.abort()
  await assert.rejects(pending, e => e?.name === 'AbortError')
  assert.equal(cleared, 'timer-1')

  // already aborted: rejects without ever arming a timer
  const pre = new AbortController()
  pre.abort()
  let setCalls = 0
  await assert.rejects(
    sleepMs(1000, pre.signal, {
      setTimer: () => {
        setCalls += 1
        return 0
      },
      clearTimer,
    }),
    e => e?.name === 'AbortError',
  )
  assert.equal(setCalls, 0)

  // normal completion still resolves (real short timer, no signal)
  await sleepMs(1, undefined)
})

test('streamDeepSeekQuery abandons the retry backoff when the signal aborts (no doomed retry)', async () => {
  const controller = new AbortController()
  let attempts = 0
  let threw
  try {
    for await (const _event of streamDeepSeekQuery({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'deepseek-v4-pro', messages: [] },
      maxRetries: 3,
      signal: controller.signal,
      // the user presses Ctrl-C during the backoff: the wait aborts the signal
      sleep() {
        controller.abort()
        return Promise.resolve()
      },
      async fetch() {
        attempts += 1
        return new Response('limited', {
          status: 429,
          headers: { 'retry-after': '30' },
        })
      },
    })) {
      // no events expected before the abort
    }
  } catch (error) {
    threw = error
  }

  // only the first request was made — aborting during the backoff stops the
  // loop instead of sleeping the full 30s and firing more doomed requests
  assert.equal(attempts, 1)
  assert.equal(threw?.name, 'AbortError')
})

test('shouldUseColor honors NO_COLOR (non-empty) and FORCE_COLOR precedence', () => {
  // color follows the stream's TTY-ness by default
  assert.equal(shouldUseColor({ isTTY: true }, {}), true)
  assert.equal(shouldUseColor({ isTTY: false }, {}), false)
  assert.equal(shouldUseColor(undefined, {}), false)
  // any NON-EMPTY NO_COLOR suppresses color, even on a TTY (the fix)
  assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '1' }), false)
  assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '0' }), false)
  // an empty NO_COLOR is NOT "set" per the spec
  assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '' }), true)
  // FORCE_COLOR=1 overrides both a non-TTY and NO_COLOR
  assert.equal(shouldUseColor({ isTTY: false }, { DEEPCODE_FORCE_COLOR: '1' }), true)
  assert.equal(
    shouldUseColor({ isTTY: true }, { NO_COLOR: '1', DEEPCODE_FORCE_COLOR: '1' }),
    true,
  )
})

test('displayWidth counts CJK/emoji as 2 cells and truncateToWidth never splits a wide char', () => {
  assert.equal(displayWidth('hello'), 5)
  assert.equal(displayWidth('中文'), 4) // 2 wide chars
  assert.equal(displayWidth('a中b'), 4)
  assert.equal(displayWidth('😀'), 2)
  assert.equal(displayWidth('\x1b[31m中\x1b[0m'), 2) // SGR colour stripped
  // non-SGR ANSI is also stripped (matches the repo's bundle string-width stub,
  // not just /\x1b\[...m/): a CSI clear-screen and an OSC set-title sequence
  assert.equal(displayWidth('\x1b[2Jhi'), 2) // CSI (non-'m' final byte)
  assert.equal(displayWidth('\x1b]0;t\x07ok'), 2) // OSC, BEL-terminated
  // OSC-8 hyperlink whose URL payload contains '/' ':' '?' is fully stripped
  // (the canonical ansi-regex handles it; the bundle stub's narrower OSC class
  // would not), so only the visible link text counts
  assert.equal(
    displayWidth('\x1b]8;;https://example.com/p?q=1\x07link\x1b]8;;\x07'),
    4,
  )
  // a literal "[1m]" with NO escape byte must NOT be stripped
  assert.equal(displayWidth('claude-opus-4-8[1m]'), 19)
  assert.equal(displayWidth('á'), 1) // combining mark is zero-width
  assert.equal(displayWidth('~/项目/深度代码'), 15) // 2 + 6 CJK chars * 2 + 1

  // truncates by display width, on a char boundary (never half a wide char)
  assert.equal(truncateToWidth('中文字符', 4), '中文')
  assert.equal(truncateToWidth('中文字符', 5), '中文') // 5 can't fit a 3rd wide char
  assert.equal(truncateToWidth('hello', 3), 'hel')
  assert.equal(truncateToWidth('a中b', 2), 'a') // 中 would overflow
})

test('the native welcome box stays aligned with CJK cwd/username (display-width aware)', () => {
  const banner = formatDeepCodeWelcome({
    cwd: '/Users/张三/项目/深度代码',
    env: { HOME: '/Users/张三', USER: '张三' },
    columns: 100,
    color: false,
  })
  // every box-border line must occupy the same number of terminal cells — with
  // code-unit .length the CJK rows overflowed and desynced the right border
  const boxWidths = banner
    .split('\n')
    .filter(line => /^[╭│╰]/.test(line))
    .map(line => displayWidth(line))
  assert.ok(boxWidths.length >= 5)
  assert.equal(new Set(boxWidths).size, 1)
  assert.equal(boxWidths[0], 100)
})

test('the native welcome banner emits no ANSI under NO_COLOR (FORCE_COLOR still wins)', () => {
  const plain = formatDeepCodeWelcome({
    env: { NO_COLOR: '1' },
    cwd: '/x',
    columns: 100,
  })
  assert.equal(plain.includes('\x1b'), false)

  const forced = formatDeepCodeWelcome({
    env: { NO_COLOR: '1', DEEPCODE_FORCE_COLOR: '1' },
    cwd: '/x',
    columns: 100,
  })
  assert.equal(forced.includes('\x1b'), true)
})

test('formatFileSize promotes a just-under-threshold value to the next unit instead of "1024KB"', () => {
  // the band must be chosen AFTER rounding: 1 MiB - 1 byte is 1023.999 KB which
  // rounds to 1024.0 — never render "1024KB" (KB tops out at 1024)
  assert.equal(formatFileSize(1048575), '1MB') // 1 MiB - 1
  assert.equal(formatFileSize(1048525), '1MB') // first byte count that rounds up
  assert.equal(formatFileSize(1073741823), '1GB') // 1 GiB - 1 (was "1024MB")

  // unchanged for everything that wasn't at a band edge
  assert.equal(formatFileSize(1023), '1023 bytes')
  assert.equal(formatFileSize(1024), '1KB')
  assert.equal(formatFileSize(1536), '1.5KB')
  assert.equal(formatFileSize(262144), '256KB') // the moat-prompt size constant
  assert.equal(formatFileSize(1047527), '1023KB') // just below the round-up edge
  assert.equal(formatFileSize(5242880), '5MB')
  assert.equal(formatFileSize(2147483648), '2GB')
})

test('parseAgentMetadata returns the object for valid metadata and null for corruption', () => {
  // valid object metadata round-trips verbatim
  assert.deepEqual(
    parseAgentMetadata('{"agentType":"general-purpose","worktreePath":"/w"}'),
    { agentType: 'general-purpose', worktreePath: '/w' },
  )
  assert.deepEqual(parseAgentMetadata('{}'), {})

  // a truncated/garbled sidecar (crash mid-write) degrades to null — the same
  // signal a missing file gives — instead of throwing and aborting the resume
  assert.equal(parseAgentMetadata('{"agentType":"general'), null)
  assert.equal(parseAgentMetadata(''), null)
  assert.equal(parseAgentMetadata('not json at all'), null)

  // non-object JSON payloads are never valid metadata → null (so resumeAgent's
  // meta?.agentType fallback applies rather than a type-confused read)
  assert.equal(parseAgentMetadata('null'), null)
  assert.equal(parseAgentMetadata('42'), null)
  assert.equal(parseAgentMetadata('"a string"'), null)
  assert.equal(parseAgentMetadata('[1,2,3]'), null)
})

test('withCronFileLock serializes concurrent read-modify-writes (no lost update)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-cronlock-'))
  const filePath = join(dir, '.claude', 'scheduled_tasks.json')

  // Inject a no-op lock so the IN-PROCESS promise chain is the only serializer
  // under test (the cross-process proper-lockfile wrapping is covered by the
  // injected-order test below, and proper-lockfile is not resolvable on CI
  // runners). Each unit: read the counter (0 if absent) -> increment ->
  // atomic-write. Fire N concurrently; without the chain the interleaved
  // read-before-write clobbers and the final count is < N.
  const lockImpl = { lock: async () => async () => {} }
  const N = 6
  const bump = () =>
    withCronFileLock(
      filePath,
      async () => {
        let n = 0
        try {
          n = JSON.parse(await readFile(filePath, 'utf8')).n
        } catch {}
        await atomicWriteFile(filePath, JSON.stringify({ n: n + 1 }))
      },
      { lockImpl },
    )
  await Promise.all(Array.from({ length: N }, bump))

  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).n, N)
  // the data file is written under .claude (no real lock sentinel with the mock)
  assert.deepEqual((await readdir(join(dir, '.claude'))).sort(), [
    'scheduled_tasks.json',
  ])
})

test('finalizePendingHooks isolates a failing hook and finalizes the rest', async () => {
  let killed = 0
  const mkHook = (id, status, code) => ({
    id,
    shellCommand:
      status === null
        ? undefined
        : {
            status,
            result: Promise.resolve({ code }),
            kill() {
              killed += 1
            },
          },
  })
  const hooks = [
    mkHook('A', 'completed', 0), // -> success
    mkHook('B', 'completed', 2), // -> error, and its finalizeHook throws
    mkHook('C', 'running', undefined), // not completed, not killed -> kill + cancelled
    mkHook('D', 'killed', undefined), // not completed but already killed -> no kill, cancelled
    mkHook('E', null, undefined), // no shellCommand -> no kill, cancelled
  ]

  const calls = []
  const errors = []
  await finalizePendingHooks(hooks, {
    finalizeHook: async (hook, code, statusLabel) => {
      calls.push(`${hook.id}:${code}:${statusLabel}`)
      if (hook.id === 'B') throw new Error('boom B')
    },
    onError: reason => errors.push(String(reason?.message ?? reason)),
  })

  // every hook is finalized despite B throwing (allSettled isolation), the
  // running hook is killed, the already-killed and shellCommand-less ones are
  // not, the single failure is reported, and the call RESOLVES (so the caller's
  // unconditional clear() always runs).
  assert.deepEqual(calls.sort(), [
    'A:0:success',
    'B:2:error',
    'C:1:cancelled',
    'D:1:cancelled',
    'E:1:cancelled',
  ])
  assert.equal(killed, 1)
  assert.deepEqual(errors, ['boom B'])
})

test('finalizePendingHooks resolves even when onError itself throws', async () => {
  // The production onError (logForDebugging) can throw in immediate-debug mode
  // (synchronous file append). A throwing reporter must NOT reject the settle,
  // or the caller's unconditional clear() would be skipped — the exact leak the
  // fix closes.
  let finalized = 0
  const hooks = [
    { id: 'A', shellCommand: { status: 'completed', result: Promise.resolve({ code: 0 }), kill() {} } },
    { id: 'B', shellCommand: { status: 'completed', result: Promise.resolve({ code: 0 }), kill() {} } },
  ]
  await assert.doesNotReject(
    finalizePendingHooks(hooks, {
      finalizeHook: async () => {
        finalized += 1
        throw new Error('finalize failed')
      },
      onError: () => {
        throw new Error('reporter blew up')
      },
    }),
  )
  // both hooks were still attempted despite every finalize + every onError throwing
  assert.equal(finalized, 2)
})

test('withCronFileLock acquires the cross-process lock around fn and releases it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-cronlock-mock-'))
  const filePath = join(dir, '.claude', 'scheduled_tasks.json')
  const events = []
  const lockImpl = {
    lock: async (_path, opts) => {
      events.push(`lock:${opts.realpath}:${opts.stale}`)
      return async () => {
        events.push('release')
      }
    },
  }

  const result = await withCronFileLock(
    filePath,
    async () => {
      events.push('fn')
      return 'value'
    },
    { lockImpl },
  )

  assert.equal(result, 'value')
  // the file lock (realpath:false so it never requires the data file to exist,
  // stale:10000 to break a crashed holder) wraps fn and is always released
  assert.deepEqual(events, ['lock:false:10000', 'fn', 'release'])
})

test('initWheelAccel returns the documented initial accel state', () => {
  assert.deepEqual(initWheelAccel(false, 1), {
    time: 0, mult: 1, dir: 0, xtermJs: false, frac: 0, base: 1,
    pendingFlip: false, wheelMode: false, burstCount: 0,
  })
  assert.deepEqual(initWheelAccel(true, 3), {
    time: 0, mult: 3, dir: 0, xtermJs: true, frac: 0, base: 3,
    pendingFlip: false, wheelMode: false, burstCount: 0,
  })
})

test('computeWheelStep native path: fast same-dir events ramp, an idle gap resets', () => {
  const s = initWheelAccel(false, 1)
  // mult ramps +0.3 per sub-40ms event (1.3,1.6,1.9,2.2,2.5,2.8 → floored)
  const steps = []
  let t = 0
  for (let i = 0; i < 6; i++) { steps.push(computeWheelStep(s, 1, t)); t += 10 }
  assert.deepEqual(steps, [1, 1, 1, 2, 2, 2])
  // a gap beyond the 40ms accel window resets the multiplier to base
  assert.equal(computeWheelStep(s, 1, t + 100), 1)
})

test('computeWheelStep native path: an encoder bounce (flip + quick flip-back) engages wheel mode', () => {
  const s = initWheelAccel(false, 1)
  computeWheelStep(s, 1, 0) // establish dir = 1
  // a direction flip is DEFERRED (returns 0, no scroll) pending bounce-vs-reversal
  assert.equal(computeWheelStep(s, -1, 100), 0)
  assert.equal(s.pendingFlip, true)
  // flip-back to the original dir within the bounce window → confirmed bounce → wheel mode
  computeWheelStep(s, 1, 150)
  assert.equal(s.wheelMode, true)
  assert.equal(s.pendingFlip, false)
})

test('computeWheelStep native path: a persisted reversal commits (not a bounce)', () => {
  const s = initWheelAccel(false, 1)
  computeWheelStep(s, 1, 0)
  assert.equal(computeWheelStep(s, -1, 100), 0) // defer
  // the SAME new direction again → real reversal: commit, reset mult, do NOT engage wheelMode
  computeWheelStep(s, -1, 150)
  assert.equal(s.dir, -1)
  assert.equal(s.wheelMode, false)
})

test('computeWheelStep xterm.js path: initial kick is 2, a same-dir sub-5ms burst is 1', () => {
  const s = initWheelAccel(true, 1)
  assert.equal(computeWheelStep(s, 1, 0), 2) // reversal-from-rest kick
  assert.equal(computeWheelStep(s, 1, 2), 1) // same-batch burst (gap < 5ms) → 1 row
})

test('readScrollSpeedBase reads + clamps the scroll-speed env var', () => {
  const orig = process.env.CLAUDE_CODE_SCROLL_SPEED
  try {
    delete process.env.CLAUDE_CODE_SCROLL_SPEED
    assert.equal(readScrollSpeedBase(), 1) // unset → default 1
    process.env.CLAUDE_CODE_SCROLL_SPEED = '3'
    assert.equal(readScrollSpeedBase(), 3)
    process.env.CLAUDE_CODE_SCROLL_SPEED = 'abc'
    assert.equal(readScrollSpeedBase(), 1) // non-numeric → 1
    process.env.CLAUDE_CODE_SCROLL_SPEED = '-5'
    assert.equal(readScrollSpeedBase(), 1) // <= 0 → 1
    process.env.CLAUDE_CODE_SCROLL_SPEED = '50'
    assert.equal(readScrollSpeedBase(), 20) // clamp to 20
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_CODE_SCROLL_SPEED
    else process.env.CLAUDE_CODE_SCROLL_SPEED = orig
  }
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

test('parseDeepSeekSSELines skips a malformed/truncated data line instead of crashing the stream', () => {
  // ROBUSTNESS regression: a single corrupt SSE line (network glitch / proxy /
  // a connection dropped mid-message so the final-buffer flush sees partial
  // JSON) must NOT throw — it would abort streamDeepSeekResponseBody and lose
  // all already-received content. The bad line is skipped; the rest parses.
  let events
  assert.doesNotThrow(() => {
    events = parseDeepSeekSSELines([
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[{"delta":', // truncated JSON (dropped connection)
      'data: not json at all',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      'data: [DONE]',
    ])
  })
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'hi' },
    { type: 'content_delta', text: ' there' },
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

test('DeepSeek stream parser preserves fragmented multi-tool calls and final tool_calls finish', async () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"reasoning_content":"plan "},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read","type":"function","function":{"name":"Read","arguments":"{\\"file_"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_bash","type":"function","function":{"name":"Bash","arguments":"{\\"com"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path\\":\\"README.md\\"}"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"mand\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":13,"prompt_cache_miss_tokens":7}}',
    'data: [DONE]',
  ])
  async function* stream() {
    yield* events
  }

  const result = await collectDeepSeekStreamEvents(stream())

  assert.equal(result.reasoning, 'plan ')
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.usage, {
    prompt_cache_hit_tokens: 13,
    prompt_cache_miss_tokens: 7,
  })
  assert.deepEqual(result.toolCalls, [
    {
      id: 'call_read',
      type: 'function',
      function: {
        name: 'Read',
        arguments: '{"file_path":"README.md"}',
      },
    },
    {
      id: 'call_bash',
      type: 'function',
      function: {
        name: 'Bash',
        arguments: '{"command":"pwd"}',
      },
    },
  ])
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

  // Transient gateway / timeout statuses retry with backoff (a CDN/proxy blip must not
  // abort the turn on the first hit). Explicit set, so the non-transient 5xx fail fast.
  for (const status of [408, 500, 502, 504]) {
    const recovery = mapDeepSeekHttpError({ status })
    assert.equal(recovery.retryable, true, `status ${status} should be retryable`)
    assert.equal(recovery.retryStrategy, 'exponential_backoff', `status ${status} strategy`)
  }
  for (const status of [400, 401, 403, 404, 501, 505]) {
    assert.equal(
      mapDeepSeekHttpError({ status }).retryable,
      false,
      `status ${status} should be fatal (not transient)`,
    )
  }

  // A sane Retry-After is honored VERBATIM — including a value larger than our 8s backoff
  // ceiling (the server is authoritative; retrying earlier than it asked re-collides on
  // the 429). 7s and 30s both pass through unclamped.
  assert.equal(calculateDeepSeekRetryDelayMs({ retryAfterSeconds: 7 }, 0), 7000)
  assert.equal(calculateDeepSeekRetryDelayMs({ retryAfterSeconds: 30 }, 0), 30000)
  // Only an ABSURD Retry-After is clamped — by the separate retryAfterMaxMs ceiling
  // (default 60s), NOT the 8s backoff cap — so a hostile `Retry-After: 86400` can't freeze
  // the agent for a day; and a negative value floors at 0 (never a negative sleep).
  assert.equal(calculateDeepSeekRetryDelayMs({ retryAfterSeconds: 86400 }, 0), 60000)
  assert.equal(
    calculateDeepSeekRetryDelayMs({ retryAfterSeconds: 86400 }, 0, { retryAfterMaxMs: 8000 }),
    8000,
  )
  assert.equal(calculateDeepSeekRetryDelayMs({ retryAfterSeconds: -5 }, 0), 0)

  // Exponential backoff now carries equal jitter in [ceiling/2, ceiling]. random()=>1
  // yields the full ceiling (the old deterministic value — behavior-identity anchor),
  // random()=>0 yields the floor; every draw stays within the band.
  assert.equal(
    calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => 1 }),
    400,
  )
  assert.equal(
    calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => 0 }),
    200,
  )
  for (const r of [0, 0.13, 0.5, 0.87, 0.999]) {
    const delay = calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => r })
    assert.ok(delay >= 200 && delay <= 400, `jitter ${r} -> ${delay} out of [200,400]`)
  }
  // The [ceiling/2, ceiling] bound holds UNCONDITIONALLY: a misbehaving injected rng that
  // returns out of [0,1) (negative, >= 1, or NaN) is coerced to the domain, so it can never
  // yield a negative sleep or one above the cap (random is reachable via context.random).
  assert.equal(calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => -2 }), 200)
  assert.equal(calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => 2 }), 400)
  assert.equal(calculateDeepSeekRetryDelayMs({}, 2, { retryBaseDelayMs: 100, random: () => NaN }), 200)
  // Jitter is preserved even once the delay is capped (decorrelates at the boundary).
  assert.equal(
    calculateDeepSeekRetryDelayMs({}, 10, { retryBaseDelayMs: 500, retryMaxDelayMs: 8000, random: () => 0 }),
    4000,
  )
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
  // finish_reason bundled on the content chunk now yields a finish event (it was
  // dropped before — a pure-text turn ended stop_reason:null). The retry behavior
  // (attempts/delays) is what this test pins; finish is the corrected by-product.
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'ok' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'done' },
  ])
})

test('streamDeepSeekQuery throws DEEPCODE_REQUEST_TIMEOUT when fetch outlives timeout', async () => {
  const start = Date.now()
  let caught
  try {
    for await (const _ of streamDeepSeekQuery({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'deepseek-v4-pro', messages: [] },
      maxRetries: 0,
      requestTimeoutMs: 50,
      sleep: () => Promise.resolve(),
      fetch(_url, opts) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000)
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      },
    })) {
      // unreachable
    }
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof Error, 'expected timeout to throw')
  assert.equal(caught.code, 'DEEPCODE_REQUEST_TIMEOUT')
  assert.equal(caught.timeoutMs, 50)
  assert.ok(Date.now() - start < 2000, 'should not wait the full mock duration')
})

test('streamDeepSeekQuery retries after timeout and then succeeds', async () => {
  let attempts = 0
  const delays = []
  const events = []
  for await (const event of streamDeepSeekQuery({
    url: 'https://api.deepseek.com/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'deepseek-v4-pro', messages: [] },
    maxRetries: 1,
    requestTimeoutMs: 50,
    sleep(ms) {
      delays.push(ms)
      return Promise.resolve()
    },
    fetch(_url, opts) {
      attempts += 1
      if (attempts === 1) {
        return new Promise((resolve, reject) => {
          const keepAlive = setTimeout(resolve, 5000)
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(keepAlive)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      }
      return Promise.resolve(
        new Response(sseBody([
          'data: {"choices":[{"delta":{"content":"recovered"},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]), { status: 200 }),
      )
    },
  })) {
    events.push(event)
  }
  assert.equal(attempts, 2)
  assert.equal(delays.length, 1)
  // see the note above: a bundled finish_reason now correctly yields a finish event.
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'recovered' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'done' },
  ])
})

test('streamDeepSeekQuery propagates user abort without retry', async () => {
  const ac = new AbortController()
  let attempts = 0
  const delays = []
  setTimeout(() => ac.abort(new Error('user-cancel')), 30)
  let caught
  try {
    for await (const _ of streamDeepSeekQuery({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'deepseek-v4-pro', messages: [] },
      maxRetries: 2,
      requestTimeoutMs: 30000,
      signal: ac.signal,
      sleep(ms) {
        delays.push(ms)
        return Promise.resolve()
      },
      fetch(_url, opts) {
        attempts += 1
        return new Promise((resolve, reject) => {
          const keepAlive = setTimeout(resolve, 5000)
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(keepAlive)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      },
    })) {
      // unreachable
    }
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof Error, 'expected abort to throw')
  assert.equal(caught.name, 'AbortError')
  assert.equal(attempts, 1, 'user abort must not retry')
  assert.deepEqual(delays, [], 'user abort must not sleep between retries')
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

  assert.deepEqual(tools.map(tool => tool.name), ['Read', 'Edit', 'Write', 'Bash'])
  assert.deepEqual(stable.stableTools.map(tool => tool.name), ['Bash', 'Edit', 'Read', 'Write'])
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
    // real DeepSeek buildRequest (runDeepSeekAgent builds via the provider now);
    // streamQuery is mocked to drive the tool loop.
    ...createDeepSeekProvider(),
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
  const assistantMessages = messages.filter(m => m.type === 'assistant')
  assert.deepEqual(assistantMessages.map(message => message.message.content), [
    [{ type: 'text', text: 'done' }],
  ])
  assert.equal(assistantMessages[0].message.stop_reason, 'stop')
})

test('createDeepSeekCallModel streams thinking and text events incrementally', async () => {
  const callModel = createDeepSeekCallModel({
    provider: {
      streamQuery() {
        return (async function* stream() {
          yield { type: 'reasoning_delta', text: 'Let me think...' }
          yield { type: 'reasoning_delta', text: ' more reasoning' }
          yield { type: 'content_delta', text: 'Hello' }
          yield { type: 'content_delta', text: ' world' }
          yield { type: 'finish', finishReason: 'stop' }
          yield { type: 'usage', usage: { prompt_tokens: 8, completion_tokens: 4 } }
        })()
      },
    },
    now: () => new Date('2026-05-04T00:00:00.000Z'),
    uuid: () => 'uuid-fixed',
  })

  const messages = []
  for await (const message of callModel({
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: ['You are Deep Code.'],
    tools: [],
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })) {
    messages.push(message)
  }

  const streamEvents = messages
    .filter(m => m.type === 'stream_event')
    .map(m => m.event)

  const types = streamEvents.map(e => {
    if (e.type === 'content_block_start') return `start:${e.content_block.type}`
    if (e.type === 'content_block_delta') return `delta:${e.delta.type}`
    if (e.type === 'content_block_stop') return 'stop'
    return e.type
  })

  assert.deepEqual(types, [
    'message_start',
    'start:thinking',
    'delta:thinking_delta',
    'delta:thinking_delta',
    'stop',
    'start:text',
    'delta:text_delta',
    'delta:text_delta',
    'stop',
    'message_delta',
    'message_stop',
  ])

  const thinkingDeltas = streamEvents
    .filter(e => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta')
    .map(e => e.delta.thinking)
  assert.deepEqual(thinkingDeltas, ['Let me think...', ' more reasoning'])

  const textDeltas = streamEvents
    .filter(e => e.type === 'content_block_delta' && e.delta.type === 'text_delta')
    .map(e => e.delta.text)
  assert.deepEqual(textDeltas, ['Hello', ' world'])

  const assistantMessages = messages.filter(m => m.type === 'assistant')
  assert.equal(assistantMessages.length, 1)
  const finalContent = assistantMessages[0].message.content
  const thinkingBlock = finalContent.find(block => block.type === 'thinking')
  const textBlock = finalContent.find(block => block.type === 'text')
  assert.equal(thinkingBlock?.thinking, 'Let me think... more reasoning')
  assert.equal(textBlock?.text, 'Hello world')
})

test('createDeepSeekCallModel streams tool_use as input_json_delta events', async () => {
  const callModel = createDeepSeekCallModel({
    provider: {
      streamQuery() {
        return (async function* stream() {
          yield { type: 'reasoning_delta', text: 'I should call Read' }
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
        })()
      },
    },
    now: () => new Date('2026-05-04T00:00:00.000Z'),
    uuid: () => 'uuid-fixed',
  })

  const messages = []
  for await (const message of callModel({
    messages: [{ role: 'user', content: 'read the readme' }],
    systemPrompt: ['You are Deep Code.'],
    tools: [],
    signal: new AbortController().signal,
    options: { model: 'deepseek-v4-pro' },
  })) {
    messages.push(message)
  }

  const streamEvents = messages
    .filter(m => m.type === 'stream_event')
    .map(m => m.event)

  const toolStart = streamEvents.find(
    e => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
  )
  assert.ok(toolStart, 'expected tool_use content_block_start')
  assert.equal(toolStart.content_block.id, 'call_1')
  assert.equal(toolStart.content_block.name, 'Read')

  const jsonDeltas = streamEvents
    .filter(e => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta')
    .map(e => e.delta.partial_json)
  assert.deepEqual(jsonDeltas, ['{"file_path":', '"README.md"}'])

  const assistantMessages = messages.filter(m => m.type === 'assistant')
  const toolUse = assistantMessages[0].message.content.find(b => b.type === 'tool_use')
  assert.deepEqual(toolUse.input, { file_path: 'README.md' })
  assert.equal(assistantMessages[0].message.stop_reason, 'tool_use')
})

test('createDeepSeekCallModel forwards query runtime controls to DeepSeek provider', async () => {
  const requests = []
  const callModel = createDeepSeekCallModel({
    provider: {
      // name 'deepseek' so model resolution applies DeepSeek model-guarding
      // (a foreign model name like 'claude-sonnet-4-5' must NOT reach DeepSeek);
      // real providers always carry a name.
      name: 'deepseek',
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

test('Deep Code migration diagnostics warn on legacy-only project config paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-migration-'))
  await mkdir(join(cwd, '.claude', 'skills', 'legacy-skill'), {
    recursive: true,
  })
  await mkdir(join(cwd, '.claude', 'agents'), { recursive: true })
  await writeFile(join(cwd, 'CLAUDE.md'), 'legacy instructions')
  await writeFile(join(cwd, '.claude', 'settings.json'), '{}')
  await writeFile(
    join(cwd, '.claude', 'skills', 'legacy-skill', 'SKILL.md'),
    '# skill',
  )

  const diagnostics = createDeepCodeMigrationDiagnostics({
    env: {
      DEEPCODE_CONFIG_DIR: join(cwd, 'home', '.deepcode'),
      CLAUDE_CONFIG_DIR: join(cwd, 'home', '.claude'),
    },
    cwd,
  })

  assert.equal(diagnostics.status, 'warn')
  assert.ok(
    diagnostics.legacyOnly.some(item => item.label === 'Project instructions'),
  )
  assert.ok(
    diagnostics.legacyOnly.some(item => item.label === 'Project settings'),
  )
  assert.ok(
    diagnostics.legacyOnly.some(item => item.label === 'Project skills'),
  )
  assert.match(diagnostics.detail, /legacy fallback active/i)
  assert.match(diagnostics.recommendation, /DEEPCODE\.md/)
  assert.match(diagnostics.recommendation, /\.deepcode/)
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
      ...createDeepSeekProvider(),
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
    'Write',
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
      ...createDeepSeekProvider(),
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
    ['Bash', 'Edit', 'Read', 'Write'],
  )
  assert.equal(requests.length, 1)
  assert.deepEqual(
    requests[0].body.tools.map(tool => tool.function.name),
    ['Bash', 'Edit', 'Read', 'Write'],
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

test('runDeepCodeAgentRuntimeE2E records default worker lifecycle through Agent tool call', async () => {
  const requests = []
  const result = await runDeepCodeAgentRuntimeE2E({
    env: {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPCODE_HARNESS_MODE: 'on',
    },
    complete(request) {
      requests.push(request.body)
      if (requests.length === 1) {
        return {
          content: '',
          reasoning: 'Delegate a focused worker.',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'call_agent',
              type: 'function',
              function: {
                name: 'Agent',
                arguments: JSON.stringify({
                  description: 'Inspect lifecycle',
                  prompt: 'Inspect DeepSeek Harness lifecycle.',
                }),
              },
            },
          ],
        }
      }
      return {
        content: 'deepcode-agent-e2e-ok',
        reasoning: '',
        finishReason: 'stop',
        toolCalls: [],
        usage: {
          prompt_cache_hit_tokens: 64,
          prompt_cache_miss_tokens: 16,
        },
      }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.content, 'deepcode-agent-e2e-ok')
  assert.equal(result.lifecycle.selectedProfile, 'worker')
  assert.equal(result.lifecycle.selection, 'default')
  assert.equal(result.lifecycle.requestedProfile, 'omitted')
  assert.equal(result.runtimeDecision.state, 'harness')
  assert.equal(requests[0].tools[0].function.name, 'Agent')
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'call_agent')
  assert.equal(result.cacheDiagnostics.promptCacheHitTokens, 64)
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

async function countTmpSiblings(dir, baseName) {
  const names = await readdir(dir)
  return names.filter(n => n.startsWith(`${baseName}.`) && n.endsWith('.tmp')).length
}

test('omitUndefined drops only undefined values and preserves key order', () => {
  // only `undefined` is dropped — null/false/0/'' are kept (the request builders rely on
  // this to send an explicit null/0 while omitting an absent optional field).
  assert.deepEqual(
    omitUndefined({ a: 1, b: undefined, c: null, d: false, e: 0, f: '' }),
    { a: 1, c: null, d: false, e: 0, f: '' },
  )
  // an empty / all-undefined object collapses to {}
  assert.deepEqual(omitUndefined({}), {})
  assert.deepEqual(omitUndefined({ x: undefined, y: undefined }), {})
  // key order of the kept entries is preserved (moat-relevant: a kept key never moves)
  assert.deepEqual(
    Object.keys(omitUndefined({ z: 1, m: undefined, a: 2, k: 3 })),
    ['z', 'a', 'k'],
  )
})

test('atomicWriteFile writes via temp+rename, preserves an existing file mode, and leaves no temp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-atomic-'))

  // new file: content lands, no leftover temp, and the mode is IDENTICAL to what a direct
  // writeFile would produce (proves we did not force a restrictive state-file mode).
  const fresh = join(dir, 'fresh.txt')
  await atomicWriteFile(fresh, 'hello')
  assert.equal(await readFile(fresh, 'utf8'), 'hello')
  assert.equal(await countTmpSiblings(dir, 'fresh.txt'), 0)
  const direct = join(dir, 'direct.txt')
  await writeFile(direct, 'hello')
  assert.equal((await stat(fresh)).mode, (await stat(direct)).mode)

  // overwrite preserves the existing file's mode (rename installs a new inode, so the
  // permission bits must be copied — a direct writeFile O_TRUNC would have kept them).
  const script = join(dir, 'run.sh')
  await writeFile(script, 'echo old')
  await chmod(script, 0o755)
  const inoBefore = (await stat(script)).ino
  await atomicWriteFile(script, 'echo new')
  assert.equal(await readFile(script, 'utf8'), 'echo new')
  assert.equal((await stat(script)).mode & 0o777, 0o755)
  assert.equal(await countTmpSiblings(dir, 'run.sh'), 0)
  // The inode CHANGED — proof the write went through temp+rename, not an in-place
  // O_TRUNC overwrite (this assertion fails against the old direct-writeFile code, so it
  // discriminates the atomic mechanism, not just the end state).
  assert.notEqual((await stat(script)).ino, inoBefore)

  // a 0o600 secret keeps its restrictive mode through an overwrite
  const secret = join(dir, 'secret.env')
  await writeFile(secret, 'A=1')
  await chmod(secret, 0o600)
  await atomicWriteFile(secret, 'A=2')
  assert.equal((await stat(secret)).mode & 0o777, 0o600)
})

test('atomicWriteFile leaves the original intact and cleans the temp when the rename fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-atomic-fail-'))
  // target is a directory: write to temp succeeds, rename onto a dir fails → the catch
  // must remove the temp and rethrow the ORIGINAL rename error (EISDIR), and the original
  // (the dir) must be untouched.
  const target = join(dir, 'busy')
  await mkdir(target)
  await assert.rejects(
    () => atomicWriteFile(target, 'data'),
    error => error.code === 'EISDIR' || error.code === 'ENOTEMPTY' || error.code === 'EPERM',
  )
  assert.equal((await stat(target)).isDirectory(), true)
  assert.equal(await countTmpSiblings(dir, 'busy'), 0)
})

test('atomicWriteFile follows a symlink target (writes through, keeps the link)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-atomic-link-'))
  const real = join(dir, 'real.txt')
  const link = join(dir, 'link.txt')
  await writeFile(real, 'original')
  await symlink(real, link)

  await atomicWriteFile(link, 'updated')

  // the symlink is preserved (NOT replaced by a regular file) and its target got the write
  assert.equal((await lstat(link)).isSymbolicLink(), true)
  assert.equal(await readFile(real, 'utf8'), 'updated')
  assert.equal(await readFile(link, 'utf8'), 'updated')
  // the temp landed next to the REAL file, and none leaked
  assert.equal(await countTmpSiblings(dir, 'real.txt'), 0)
  assert.equal(await countTmpSiblings(dir, 'link.txt'), 0)
})

test('atomicWriteFile follows a DANGLING symlink (creates the target, keeps the link)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-atomic-dangling-'))
  const missing = join(dir, 'not-yet.txt')
  const link = join(dir, 'pending.txt')
  await symlink(missing, link) // points at a file that does not exist yet

  await atomicWriteFile(link, 'created')

  // the old writeFile would follow the link and create the target; we must too — write
  // through to the target and preserve the symlink, rather than replacing the link.
  assert.equal((await lstat(link)).isSymbolicLink(), true)
  assert.equal(await readFile(missing, 'utf8'), 'created')
  assert.equal(await readFile(link, 'utf8'), 'created')
  assert.equal(await countTmpSiblings(dir, 'not-yet.txt'), 0)
})

test('atomicWriteFile throws ENOENT for a missing parent dir and EACCES for a read-only target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-atomic-edge-'))

  // missing parent directory is NOT created (matches a direct write)
  await assert.rejects(
    () => atomicWriteFile(join(dir, 'nope', 'f.txt'), 'x'),
    error => error.code === 'ENOENT',
  )
  assert.deepEqual(await readdir(dir), [])

  // a read-only existing file is NOT silently replaced — rename is gated on the parent dir,
  // so without the W_OK guard a 0o444 file the old writeFile rejected would be overwritten.
  // (skip under root, which bypasses permission checks.)
  if (!(process.getuid && process.getuid() === 0)) {
    const ro = join(dir, 'readonly.txt')
    await writeFile(ro, 'locked')
    await chmod(ro, 0o444)
    await assert.rejects(
      () => atomicWriteFile(ro, 'overwrite'),
      error => error.code === 'EACCES',
    )
    assert.equal(await readFile(ro, 'utf8'), 'locked')
    assert.equal(await countTmpSiblings(dir, 'readonly.txt'), 0)
  }
})

test('local Edit/Write tools persist atomically and preserve the edited file mode', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-toolchain-atomic-'))
  const tools = createDeepSeekLocalTools({ cwd })
  const edit = tools.find(tool => tool.name === 'Edit')
  const write = tools.find(tool => tool.name === 'Write')

  // Write then Edit a file whose mode was tightened — the edit must keep the mode and
  // leave no temp sibling behind.
  await write.execute({ file_path: 'app.txt', content: 'value=1\n' }, { cwd })
  assert.equal(await readFile(join(cwd, 'app.txt'), 'utf8'), 'value=1\n')

  await chmod(join(cwd, 'app.txt'), 0o640)
  await edit.execute(
    { file_path: 'app.txt', old_string: 'value=1', new_string: 'value=2' },
    { cwd },
  )
  assert.equal(await readFile(join(cwd, 'app.txt'), 'utf8'), 'value=2\n')
  assert.equal((await stat(join(cwd, 'app.txt')).then(s => s.mode & 0o777)), 0o640)
  assert.equal(await countTmpSiblings(cwd, 'app.txt'), 0)
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

test('saveDeepSeekConfigFile persists wizard output and loadDeepSeekConfigFile reads it back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const env = { DEEPCODE_CONFIG_FILE: join(dir, 'deepseek.json') }

  assert.equal(hasDeepSeekConfigFile({ env }), false)
  assert.equal(loadDeepSeekConfigFile({ env }), null)

  const path = saveDeepSeekConfigFile(
    {
      apiKey: 'sk-from-wizard',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    },
    { env },
  )

  assert.equal(path, join(dir, 'deepseek.json'))
  assert.equal(hasDeepSeekConfigFile({ env }), true)

  const loaded = loadDeepSeekConfigFile({ env })
  assert.equal(loaded.apiKey, 'sk-from-wizard')
  assert.equal(loaded.model, 'deepseek-v4-pro')
  assert.equal(loaded.reasoningEffort, 'high')
  assert.equal(typeof loaded.completedAt, 'string')
})

test('resolveDeepSeekConfig falls back to persisted file when env vars are absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const filePath = join(dir, 'deepseek.json')
  const env = { DEEPCODE_CONFIG_FILE: filePath }

  saveDeepSeekConfigFile(
    {
      apiKey: 'sk-from-file',
      baseUrl: 'https://example.test/v1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    },
    { env },
  )

  const config = resolveDeepSeekConfig({ env, cwd: dir })
  assert.equal(config.apiKey, 'sk-from-file')
  assert.equal(config.baseUrl, 'https://example.test/v1')
  assert.equal(config.model, 'deepseek-v4-flash')
  assert.equal(config.reasoningEffort, 'high')
})

test('resolveDeepSeekConfig env var beats persisted file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const filePath = join(dir, 'deepseek.json')
  const env = {
    DEEPCODE_CONFIG_FILE: filePath,
    DEEPSEEK_API_KEY: 'sk-from-env',
    DEEPSEEK_MODEL: 'deepseek-v4-pro',
  }

  saveDeepSeekConfigFile(
    {
      apiKey: 'sk-from-file',
      model: 'deepseek-v4-flash',
    },
    { env },
  )

  const config = resolveDeepSeekConfig({ env, cwd: dir })
  assert.equal(config.apiKey, 'sk-from-env')
  assert.equal(config.model, 'deepseek-v4-pro')
})

test('resolveDeepSeekConfigPath honours DEEPCODE_CONFIG_DIR override', () => {
  const env = { DEEPCODE_CONFIG_DIR: '/tmp/custom-deepcode' }
  assert.equal(
    resolveDeepSeekConfigPath({ env }),
    '/tmp/custom-deepcode/deepseek-config.json',
  )
})

test('mergeDeepSeekConfigPartial preserves existing keys not touched by the wizard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const filePath = join(dir, 'deepseek.json')
  const env = { DEEPCODE_CONFIG_FILE: filePath }

  saveDeepSeekConfigFile(
    {
      apiKey: 'sk-old',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      smallModel: 'deepseek-v4-flash',
      thinking: 'enabled',
      reasoningEffort: 'max',
    },
    { env },
  )

  const merged = mergeDeepSeekConfigPartial(
    {
      apiKey: 'sk-new',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    },
    { env },
  )

  assert.equal(merged.apiKey, 'sk-new')
  assert.equal(merged.model, 'deepseek-v4-flash')
  assert.equal(merged.reasoningEffort, 'high')
  assert.equal(merged.smallModel, 'deepseek-v4-flash')
  assert.equal(merged.thinking, 'enabled')
})

// The setup wizard now saves through mergeProviderConfigPartial (the nested provider
// store), NOT the flat saveDeepSeekConfigFile path. The flat path overwrote the whole
// file, silently erasing a sibling provider (e.g. one set via /provider) and resetting
// activeProvider to 'deepseek'. The nested deep-merge preserves both.
test('wizard save (mergeProviderConfigPartial) preserves a sibling provider; the old flat path clobbered it', async () => {
  // --- the FIX path: a sibling provider survives the wizard save ---
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prov-'))
  const env = { DEEPCODE_CONFIG_FILE: join(dir, 'deepseek.json') }

  mergeProviderConfigPartial(
    'openai-compatible',
    { apiKey: 'oai-key', baseUrl: 'https://my-llm' },
    { env },
  )
  // simulate the wizard's confirm save
  mergeProviderConfigPartial(
    'deepseek',
    {
      apiKey: 'ds-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    },
    { env },
  )
  const after = loadProviderConfigFile({ env })
  assert.ok(
    after.providers['openai-compatible'],
    'sibling openai-compatible provider must survive the DeepSeek wizard save',
  )
  assert.equal(after.providers['openai-compatible'].baseUrl, 'https://my-llm')
  assert.equal(after.providers.deepseek.apiKey, 'ds-key')
  assert.equal(after.activeProvider, 'deepseek')

  // --- non-vacuity: the OLD flat path DID clobber the sibling ---
  const dir2 = await mkdtemp(join(tmpdir(), 'deepseek-prov-old-'))
  const env2 = { DEEPCODE_CONFIG_FILE: join(dir2, 'deepseek.json') }
  mergeProviderConfigPartial(
    'openai-compatible',
    { apiKey: 'oai-key', baseUrl: 'https://my-llm' },
    { env: env2 },
  )
  const flatMerged = mergeDeepSeekConfigPartial(
    { apiKey: 'ds-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
    { env: env2 },
  )
  saveDeepSeekConfigFile(flatMerged, { env: env2 })
  const afterOld = loadProviderConfigFile({ env: env2 })
  assert.equal(
    afterOld.providers['openai-compatible'],
    undefined,
    'the old flat save path erased the sibling provider (the bug this fix resolves)',
  )
  assert.equal(afterOld.activeProvider, 'deepseek')
})

test('saveDeepSeekConfigFile writes file with 0600 permissions on POSIX systems', async () => {
  if (process.platform === 'win32') return
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const filePath = join(dir, 'deepseek.json')
  const env = { DEEPCODE_CONFIG_FILE: filePath }

  saveDeepSeekConfigFile({ apiKey: 'sk-secret' }, { env })

  const { statSync } = await import('node:fs')
  const stats = statSync(filePath)
  const mode = stats.mode & 0o777
  assert.equal(mode, 0o600)
})

test('saveDeepSeekConfigFile rejects non-object payload before touching the filesystem', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-config-'))
  const filePath = join(dir, 'deepseek.json')
  const env = { DEEPCODE_CONFIG_FILE: filePath }

  saveDeepSeekConfigFile({ apiKey: 'sk-original' }, { env })
  const original = await readFile(filePath, 'utf8')

  assert.throws(
    () => saveDeepSeekConfigFile([] /* not a plain object */, { env }),
    /plain object/,
  )

  const after = await readFile(filePath, 'utf8')
  assert.equal(after, original, 'config file must be untouched after rejected save')
})

// ── P2.11.a — prefix-cache moat self-verification ────────────────────────────
// DeepCode's headline is "we keep the DeepSeek prefix cache hot across long
// sessions." That only holds if every turn re-sends the prior turns BYTE-IDENTICAL
// and only APPENDS new messages — never mutating an earlier message or the system
// prefix. These tests drive the REAL buildDeepSeekRequest + mapMessagesToDeepSeek
// and assert that invariant at the wire level, so a future serializer/normalizer
// change that silently breaks the cache fails CI. (Reasonix's cachehit_e2e_test.go
// asserts the same thing as hitChars[i] === reqChars[i-1].)

// per-message wire snapshot: the bytes that would actually be sent for each message
const perMessageBytes = messages => messages.map(m => JSON.stringify(m))

test('runDeepSeekAgent keeps the request message-prefix byte-stable across tool turns (prefix-cache moat)', async () => {
  const TOOL_TURNS = 3
  const turns = []
  await runDeepSeekAgent({
    prompt: 'begin the task',
    env: { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_CACHE_USER_ID: 'workspace-1' },
    systemPrompt: [{ type: 'text', text: 'You are a stable-prefix coding agent.' }],
    tools: [
      {
        name: 'noop',
        description: 'a no-op tool used to force tool-call turns',
        inputJSONSchema: {
          type: 'object',
          properties: { step: { type: 'number' } },
          required: [],
        },
        async execute() {
          return 'ok'
        },
      },
    ],
    maxTurns: TOOL_TURNS + 2,
    // complete() receives the exact request built by buildDeepSeekRequest each turn,
    // so request.body.messages is the wire representation we must keep prefix-stable.
    async complete(request) {
      turns.push(perMessageBytes(request.body.messages))
      if (turns.length <= TOOL_TURNS) {
        return {
          content: '',
          reasoning: `reasoning trajectory step ${turns.length}`,
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: `call_${turns.length}`,
              type: 'function',
              function: { name: 'noop', arguments: `{"step":${turns.length}}` },
            },
          ],
        }
      }
      return { content: 'all done', reasoning: '', finishReason: 'stop', toolCalls: [] }
    },
  })

  assert.ok(turns.length >= 3, `expected a multi-turn tool loop, got ${turns.length}`)
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1]
    const cur = turns[i]
    assert.ok(
      cur.length >= prev.length,
      `turn ${i}: request must only grow (prev=${prev.length}, cur=${cur.length})`,
    )
    const reqCharsPrev = prev.reduce((sum, m) => sum + m.length, 0)
    let hitChars = 0
    for (let k = 0; k < prev.length; k++) {
      assert.equal(
        cur[k],
        prev[k],
        `turn ${i}: message[${k}] changed byte-for-byte — prefix cache would miss here`,
      )
      hitChars += cur[k].length
    }
    // Reasonix invariant: the cached prefix on turn i equals the ENTIRE prior request.
    assert.equal(
      hitChars,
      reqCharsPrev,
      `turn ${i}: the whole previous request must be a byte-identical prefix of this one`,
    )
  }
})

test('the prefix-stability gate catches a mutated earlier message (negative control)', async () => {
  // Proves the assertion above is not vacuous: mutating an EARLIER message — the
  // exact failure mode that collapses DeepSeek's prefix cache — must break the
  // byte-prefix at an early index.
  const sys = [{ type: 'text', text: 'sys' }]
  const env = { DEEPSEEK_API_KEY: 'sk-test' }
  const base = await buildDeepSeekRequest({
    env,
    systemPrompt: sys,
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ],
  })
  const mutated = await buildDeepSeekRequest({
    env,
    systemPrompt: sys,
    messages: [
      { role: 'user', content: 'FIRST-MUTATED' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ],
  })
  const a = perMessageBytes(base.body.messages)
  const b = perMessageBytes(mutated.body.messages)
  let firstDiff = -1
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (a[k] !== b[k]) {
      firstDiff = k
      break
    }
  }
  assert.notEqual(firstDiff, -1, 'mutating an earlier message must break the byte-prefix')
  assert.ok(
    firstDiff < a.length - 1,
    'the divergence must be at an EARLY message (cache collapses from there forward)',
  )
})

test('transient per-turn content rides the message tail, never the cached system prefix', async () => {
  // The stable cache prefix = systemPromptToMessages(systemPrompt) + prior history.
  // Volatile per-turn content (attachments, <system-reminder>s) must ride the LATEST
  // user message so it never mutates the cached prefix. Two requests with an identical
  // stable prefix but DIFFERENT transient tails must share a byte-identical leading prefix.
  const sys = [{ type: 'text', text: 'stable system instructions' }]
  const env = { DEEPSEEK_API_KEY: 'sk-test' }
  const history = [
    { role: 'user', content: 'do the task' },
    { role: 'assistant', content: 'working' },
  ]
  const reqA = await buildDeepSeekRequest({
    env,
    systemPrompt: sys,
    messages: [
      ...history,
      { role: 'user', content: 'turn <system-reminder>todo: X</system-reminder>' },
    ],
  })
  const reqB = await buildDeepSeekRequest({
    env,
    systemPrompt: sys,
    messages: [
      ...history,
      {
        role: 'user',
        content: 'turn <system-reminder>todo: Y entirely different note</system-reminder>',
      },
    ],
  })
  const a = perMessageBytes(reqA.body.messages)
  const b = perMessageBytes(reqB.body.messages)
  assert.equal(a.length, b.length, 'same message count; only the tail content differs')
  const stablePrefixLen = a.length - 1
  for (let k = 0; k < stablePrefixLen; k++) {
    assert.equal(
      b[k],
      a[k],
      `message[${k}] (cached prefix) must be byte-identical regardless of the volatile tail`,
    )
  }
  assert.notEqual(
    a[a.length - 1],
    b[b.length - 1],
    'only the volatile tail message should differ between the two turns',
  )
})

test('mapMessagesToDeepSeek drops orphan tool results (post-compaction / resume safety)', async () => {
  // After a partial compaction, the kept tail can begin with a tool_result whose
  // originating assistant tool_use was summarized away. Mapped naively that becomes
  // an orphan role:'tool' message which DeepSeek's strict API rejects AND which
  // breaks the prefix cache. mapMessagesToDeepSeek must drop it.
  const withOrphan = mapMessagesToDeepSeek([
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'summarized_away', content: 'orphaned result' },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'text', text: 'continue please' }] } },
  ])
  assert.equal(
    withOrphan.filter(m => m.role === 'tool').length,
    0,
    'orphan tool result (no preceding assistant tool_call) must be dropped',
  )
  assert.ok(
    withOrphan.some(m => m.role === 'user' && m.content === 'continue please'),
    'surrounding user text must be preserved',
  )

  // A properly paired assistant tool_call + tool_result is preserved untouched.
  const paired = mapMessagesToDeepSeek([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'call_1', name: 'noop', input: {} }] },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
    },
  ])
  const toolMsgs = paired.filter(m => m.role === 'tool')
  assert.equal(toolMsgs.length, 1, 'a paired tool result must be kept')
  assert.equal(toolMsgs[0].tool_call_id, 'call_1')
})

test('reasoningReplay knob controls re-sending reasoning_content on tool turns (default preserves it)', async () => {
  // Reasonix strips reasoning_content on tool turns after a live probe showed it
  // costs ~500 uncached prompt tokens/turn. DeepCode re-sends it by deliberate
  // design (deepseekHarnessPrompts). This proves the knob WORKS — isolating that
  // the ONLY wire difference is the reasoning bytes — so a future flip can be
  // justified by data. Default stays true (no behavior change).
  async function runWith(extraEnv) {
    const reqs = []
    await runDeepSeekAgent({
      prompt: 'go',
      env: { DEEPSEEK_API_KEY: 'sk-test', DEEPCODE_CACHE_USER_ID: 'ws', ...extraEnv },
      tools: [
        {
          name: 'noop',
          description: 'x',
          inputJSONSchema: { type: 'object', properties: {}, required: [] },
          async execute() {
            return 'ok'
          },
        },
      ],
      maxTurns: 3,
      async complete(request) {
        reqs.push(request.body.messages)
        if (reqs.length === 1) {
          return {
            content: '',
            reasoning: 'because reasons',
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
          }
        }
        return { content: 'done', reasoning: '', finishReason: 'stop', toolCalls: [] }
      },
    })
    return reqs
  }

  const onReqs = await runWith({})
  const onAssistant = onReqs[1].find(m => m.role === 'assistant' && m.tool_calls)
  assert.ok(onAssistant, 'turn 2 should include the assistant tool-call message')
  assert.equal(
    onAssistant.reasoning_content,
    'because reasons',
    'default (reasoningReplay=true) keeps reasoning_content on tool turns',
  )

  const offReqs = await runWith({ DEEPCODE_REASONING_REPLAY: 'false' })
  const offAssistant = offReqs[1].find(m => m.role === 'assistant' && m.tool_calls)
  assert.ok(offAssistant)
  assert.equal(
    offAssistant.reasoning_content,
    undefined,
    'reasoningReplay=false drops reasoning_content (saves prompt tokens)',
  )

  // The ONLY difference is the reasoning bytes — tool_calls are identical.
  assert.deepEqual(offAssistant.tool_calls, onAssistant.tool_calls)
})

// --- readStdinWithTimeout: the native --compact / single-turn stdin guard -----
// An inherited-but-idle non-TTY stdin used to hang the native entrypoint forever
// (unbounded `for await … of process.stdin`). The leaf gives up after a peek
// timeout so the caller's empty-input branch fires a clear error instead.
function makeFakeTimers() {
  let nextId = 0
  const timers = new Map()
  return {
    timers,
    setTimer: cb => {
      const id = ++nextId
      timers.set(id, cb)
      return id
    },
    clearTimer: id => timers.delete(id),
    fireAll: () => {
      for (const [id, cb] of [...timers]) {
        timers.delete(id)
        cb()
      }
    },
  }
}

test('readStdinWithTimeout: idle stream gives up after the peek timeout (returns "" + warns)', async () => {
  const stream = new EventEmitter()
  const ft = makeFakeTimers()
  let warned = 0
  const p = readStdinWithTimeout(stream, 3000, {
    onTimeout: () => {
      warned += 1
    },
    setTimer: ft.setTimer,
    clearTimer: ft.clearTimer,
  })
  ft.fireAll() // simulate the 3s idle timeout firing with no data
  assert.equal(await p, '')
  assert.equal(warned, 1)
  assert.equal(ft.timers.size, 0)
})

test('readStdinWithTimeout: a real producer (data then end) returns the trimmed input, no warning', async () => {
  const stream = new EventEmitter()
  const ft = makeFakeTimers()
  let warned = 0
  const p = readStdinWithTimeout(stream, 3000, {
    onTimeout: () => {
      warned += 1
    },
    setTimer: ft.setTimer,
    clearTimer: ft.clearTimer,
  })
  stream.emit('data', Buffer.from('  hello '))
  // first chunk cancels the idle timeout
  assert.equal(ft.timers.size, 0)
  stream.emit('data', Buffer.from('world  '))
  stream.emit('end')
  assert.equal(await p, 'hello world')
  assert.equal(warned, 0)
})

test('readStdinWithTimeout: a closed empty pipe ends immediately ("" without warning)', async () => {
  const stream = new EventEmitter()
  const ft = makeFakeTimers()
  let warned = 0
  const p = readStdinWithTimeout(stream, 3000, {
    onTimeout: () => {
      warned += 1
    },
    setTimer: ft.setTimer,
    clearTimer: ft.clearTimer,
  })
  stream.emit('end')
  assert.equal(await p, '')
  assert.equal(warned, 0) // ended, did not time out
  assert.equal(ft.timers.size, 0)
})

test('readStdinWithTimeout: a late timer fire after data has arrived is a no-op', async () => {
  const stream = new EventEmitter()
  // keep the timer registered so we can fire it AFTER data (simulating a race)
  let captured
  const setTimer = cb => {
    captured = cb
    return 1
  }
  const p = readStdinWithTimeout(stream, 3000, {
    setTimer,
    clearTimer: () => {}, // do NOT remove the timer, to exercise the receivedData guard
  })
  stream.emit('data', Buffer.from('x'))
  captured() // stray timeout fires after data — must NOT resolve to ''
  stream.emit('end')
  assert.equal(await p, 'x')
})

test('readStdinWithTimeout: stream error rejects', async () => {
  const stream = new EventEmitter()
  const ft = makeFakeTimers()
  const p = readStdinWithTimeout(stream, 3000, {
    setTimer: ft.setTimer,
    clearTimer: ft.clearTimer,
  })
  stream.emit('error', new Error('boom'))
  await assert.rejects(p, /boom/)
  assert.equal(ft.timers.size, 0)
})

test('STDIN_PEEK_TIMEOUT_MS mirrors the full-CLI 3s peek', () => {
  assert.equal(STDIN_PEEK_TIMEOUT_MS, 3000)
})

test('readStdinWithTimeout: a multibyte char split across chunks decodes intact (UTF-8)', async () => {
  // '€' = bytes [0xE2,0x82,0xAC]; emit it across two separate flowing chunks. A
  // raw per-chunk Buffer.toString() would corrupt it ("���"); setEncoding('utf8')
  // installs a StringDecoder that holds the incomplete sequence across chunks.
  const stream = new PassThrough()
  const p = readStdinWithTimeout(stream, 3000)
  stream.write(Buffer.from([0xe2]))
  await new Promise(r => setTimeout(r, 10))
  stream.write(Buffer.from([0x82, 0xac]))
  stream.end()
  assert.equal(await p, '€')

  const stream2 = new PassThrough()
  const p2 = readStdinWithTimeout(stream2, 3000)
  const buf = Buffer.from('héllo 名前 🎉', 'utf8')
  stream2.write(buf.subarray(0, 3))
  await new Promise(r => setTimeout(r, 5))
  stream2.write(buf.subarray(3, 10))
  await new Promise(r => setTimeout(r, 5))
  stream2.write(buf.subarray(10))
  stream2.end()
  assert.equal(await p2, 'héllo 名前 🎉')
})

// Integration: the actual `deepcode --compact` hang the leaf + unref fix resolves.
// An open-but-idle non-TTY stdin pipe must self-exit (not hang) — this exercises
// BOTH halves (the peek timeout in the leaf AND process.stdin.unref() at exit).
test('deepcode --compact self-exits on an idle non-TTY stdin pipe (no hang)', async () => {
  const entry = `${dirname(dirname(fileURLToPath(import.meta.url)))}/deepcode.js`
  const child = spawn(process.execPath, [entry, '--compact'], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', d => (stderr += d))
  // deliberately never write or close child.stdin — the idle-pipe repro
  const result = await new Promise((resolve, reject) => {
    const kill = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('deepcode --compact hung on idle stdin (did not self-exit)'))
    }, 8000)
    child.on('exit', code => {
      clearTimeout(kill)
      resolve({ code, stderr })
    })
    child.on('error', reject)
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /no stdin data received in 3s/)
  assert.match(result.stderr, /requires transcript text or piped stdin/)
})

// --- deepSeekApiErrorHint: actionable next step for recognizable failures ------
test('deepSeekApiErrorHint: 401/402 give an actionable hint, others give none', () => {
  assert.match(deepSeekApiErrorHint(401), /Authentication failed/)
  assert.match(deepSeekApiErrorHint(401), /\/login|DEEPSEEK_API_KEY/)
  assert.match(deepSeekApiErrorHint(402), /Insufficient balance/)
  assert.equal(deepSeekApiErrorHint(500), '')
  assert.equal(deepSeekApiErrorHint(404), '')
  assert.equal(deepSeekApiErrorHint(undefined), '')
})

test('streamDeepSeekQuery: a 401 surfaces the raw body AND the actionable hint', async () => {
  const body =
    '{"error":{"message":"Authentication Fails, Your api key is invalid","type":"authentication_error"}}'
  let thrown
  try {
    for await (const _ of streamDeepSeekQuery({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'deepseek-v4-pro', messages: [] },
      maxRetries: 0,
      async fetch() {
        return new Response(body, { status: 401 })
      },
    })) {
      // no events expected — the 401 throws before streaming
    }
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'a 401 must throw')
  assert.equal(thrown.status, 401)
  // raw provider body is preserved (no information loss)
  assert.match(thrown.message, /authentication_error/)
  // …and the actionable hint is appended
  assert.match(thrown.message, /Authentication failed/)
  assert.match(thrown.message, /\/login|DEEPSEEK_API_KEY/)
})

// --- relativeNamespace: plugin command namespace from a path (cross-platform) -
test('relativeNamespace: POSIX paths derive the colon namespace (unchanged behavior)', () => {
  const opts = { platform: 'linux' }
  assert.equal(relativeNamespace('/x/commands/foo/bar', '/x/commands', opts), 'foo:bar')
  assert.equal(relativeNamespace('/x/commands/foo', '/x/commands', opts), 'foo')
  assert.equal(relativeNamespace('/x/commands', '/x/commands', opts), '') // top-level
  assert.equal(relativeNamespace('/other/dir', '/x/commands', opts), '') // not under base
  // a POSIX path component may legitimately contain a backslash — it must NOT be
  // treated as a separator on non-win32 (byte-identical to the old inline logic)
  assert.equal(relativeNamespace('/x/commands/we\\ird', '/x/commands', opts), 'we\\ird')
})

test('relativeNamespace: Windows backslash paths derive the namespace (the fix)', () => {
  const opts = { platform: 'win32' }
  // before the fix the leading "\foo" was never stripped/split → "\foo:bar"
  assert.equal(
    relativeNamespace('C:\\x\\commands\\foo\\bar', 'C:\\x\\commands', opts),
    'foo:bar',
  )
  assert.equal(relativeNamespace('C:\\x\\commands\\foo', 'C:\\x\\commands', opts), 'foo')
  assert.equal(relativeNamespace('C:\\x\\commands', 'C:\\x\\commands', opts), '') // top-level
})

test('relativeNamespace: non-string inputs return "" (defensive)', () => {
  assert.equal(relativeNamespace(undefined, '/x', { platform: 'linux' }), '')
  assert.equal(relativeNamespace('/x/y', undefined, { platform: 'linux' }), '')
})

// --- formatDeepSeekLoginResult: distinguish a cancel from a save failure ------
test('formatDeepSeekLoginResult: a save FAILURE reports the cause, not "Login cancelled"', () => {
  // success
  assert.equal(formatDeepSeekLoginResult(true), 'DeepSeek credentials configured')
  // success wins even if an (irrelevant) error is somehow passed
  assert.equal(formatDeepSeekLoginResult(true, 'x'), 'DeepSeek credentials configured')
  // a real cancel (no error) — unchanged message
  assert.equal(formatDeepSeekLoginResult(false), 'Login cancelled')
  assert.equal(formatDeepSeekLoginResult(false, ''), 'Login cancelled') // empty reason = cancel
  // a save failure carries the reason + an actionable hint, NOT "Login cancelled"
  const failure = formatDeepSeekLoginResult(
    false,
    "EACCES: permission denied, open '/home/me/.deepcode/config.json'",
  )
  assert.match(failure, /Login failed/)
  assert.match(failure, /EACCES: permission denied/)
  assert.match(failure, /write permissions/)
  assert.doesNotMatch(failure, /Login cancelled/)
})

test('formatDeepSeekSetupAbort: a save FAILURE surfaces the reason, not the generic write-the-file advice', () => {
  // no error → the generic key-required guidance (unchanged)
  const generic = formatDeepSeekSetupAbort()
  assert.match(generic, /requires a DeepSeek API key/)
  assert.match(generic, /DEEPSEEK_API_KEY/)
  // a save failure → the real reason + write-permission hint, and it must NOT tell
  // the user to write the very file the write just failed on
  const failure = formatDeepSeekSetupAbort(
    "ENOSPC: no space left on device, write '/home/me/.deepcode/deepseek-config.json'",
  )
  assert.match(failure, /could not save/)
  assert.match(failure, /ENOSPC: no space left/)
  assert.match(failure, /write permissions/)
  assert.doesNotMatch(failure, /requires a DeepSeek API key/)
})

import { readFileSync as fsReadFileSyncForSettingsPin } from 'node:fs'

test('updateSettingsForSource wraps its read-merge-write in the cross-process lock', () => {
  // settings.json is the highest-traffic shared file (model persistence,
  // permission saves, migrations) and was the one unlocked read-merge-write
  // among the shared stores — two instances writing concurrently lost each
  // other's changes last-writer-wins. The lock must be acquired BEFORE the
  // read (an RMW locked only around the write still loses updates), released
  // in a finally, and contention must surface as an error rather than a
  // silent unlocked write.
  const source = fsReadFileSyncForSettingsPin(
    new URL('../src/utils/settings/settings.ts', import.meta.url),
    'utf8',
  )
  const fnStart = source.indexOf('export function updateSettingsForSource')
  assert.ok(fnStart >= 0)
  const body = source.slice(fnStart, fnStart + 7_000)
  const lockAt = body.indexOf('lockfile.lockSync(')
  const readAt = body.indexOf('getSettingsForSourceUncached(')
  const writeAt = body.indexOf('writeFileSyncAndFlush_DEPRECATED(')
  assert.ok(lockAt > 0, 'settings write must take the cross-process lock')
  assert.ok(lockAt < readAt, 'the lock must cover the READ, not just the write')
  assert.ok(readAt < writeAt)
  assert.match(body, /ELOCKED/, 'contention must be surfaced, not ignored')
  assert.match(
    body,
    /Atomics\.wait/,
    'contention must retry briefly before surfacing (callers fire-and-forget)',
  )
  assert.match(
    body,
    /MODULE_NOT_FOUND/,
    'only a missing vendored proper-lockfile may degrade to unlocked writes',
  )
  assert.match(
    body.slice(body.indexOf('} finally {')),
    /releaseLock\?\.\(\)/,
    'the lock must be released in a finally',
  )

  // The sync pull writes the same settings files — it must take the same
  // lock (async variant) at its settings call sites.
  const syncSource = fsReadFileSyncForSettingsPin(
    new URL('../src/services/settingsSync/index.ts', import.meta.url),
    'utf8',
  )
  assert.match(syncSource, /lockfile\.lock\(/)
  assert.equal(
    (syncSource.match(/lock: true/g) ?? []).length,
    2,
    'both settings-file sync writes must request the lock',
  )
})
