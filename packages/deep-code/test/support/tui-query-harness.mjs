import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageRoot = resolve(import.meta.dirname, '../..')
const srcRoot = join(packageRoot, 'src')

const stubModules = new Map()
registerSourceStub('services/api/withRetry', `
export class FallbackTriggeredError extends Error {
  constructor(originalModel, fallbackModel) {
    super('Model fallback triggered')
    this.originalModel = originalModel
    this.fallbackModel = fallbackModel
  }
}
`)
registerSourceStub('services/api/claude', `
export async function* queryModelWithStreaming() {}
`)
registerSourceStub('services/compact/autoCompact', `
export function calculateTokenWarningState() {
  return { isAtBlockingLimit: false }
}
export function isAutoCompactEnabled() {
  return false
}
export async function autoCompactIfNeeded() {
  return { compactionResult: null, consecutiveFailures: undefined }
}
`)
registerSourceStub('services/compact/microCompact', `
export async function microcompactMessages(messages) {
  return { messages }
}
`)
registerSourceStub('services/compact/compact', `
export function buildPostCompactMessages(result) {
  return result?.summaryMessages ?? []
}
`)
registerSourceStub('services/analytics/index', `
export function logEvent() {}
`)
registerSourceStub('utils/imageValidation', `
export class ImageSizeError extends Error {}
`)
registerSourceStub('utils/imageResizer', `
export class ImageResizeError extends Error {}
`)
registerSourceStub('Tool', `
export function findToolByName(tools, name) {
  return tools?.find(tool => tool.name === name)
}
`)
registerSourceStub('utils/systemPromptType', `
export function asSystemPrompt(value) {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [String(value)]
}
`)
registerSourceStub('utils/log', `
export function logError() {}
`)
registerSourceStub('services/api/errors', `
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt too long'
export function isPromptTooLongMessage(message) {
  const content = typeof message === 'string' ? message : message?.message?.content ?? message?.content
  return String(content ?? '').includes(PROMPT_TOO_LONG_ERROR_MESSAGE)
}
`)
registerSourceStub('utils/debug', `
export function logAntError() {}
export function logForDebugging() {}
`)
registerSourceStub('utils/messages', `
export function createUserMessage(input) {
  return {
    type: 'user',
    uuid: input?.uuid ?? 'user-message',
    message: { role: 'user', content: input?.content ?? '' },
    ...input,
  }
}
export function createUserInterruptionMessage() {
  return createUserMessage({ content: '[Request interrupted]' })
}
export function normalizeMessagesForAPI(messages) {
  return messages
}
export function createSystemMessage(content, level = 'info') {
  return { type: 'system', uuid: 'system-message', content, level }
}
export function createAssistantAPIErrorMessage({ content, error } = {}) {
  return {
    type: 'assistant',
    uuid: 'assistant-api-error',
    isApiErrorMessage: true,
    apiError: error,
    message: { role: 'assistant', content: [{ type: 'text', text: content ?? '' }] },
  }
}
export function getMessagesAfterCompactBoundary(messages) {
  return messages
}
export function createToolUseSummaryMessage(summary, toolUseIds) {
  return { type: 'tool_use_summary', uuid: 'tool-use-summary', summary, toolUseIds }
}
export function createMicrocompactBoundaryMessage() {
  return { type: 'system', uuid: 'microcompact-boundary', content: 'Microcompact boundary' }
}
export function stripSignatureBlocks(messages) {
  return messages
}
`)
registerSourceStub('services/toolUseSummary/toolUseSummaryGenerator', `
export async function generateToolUseSummary() {
  return null
}
`)
registerSourceStub('utils/api', `
export function prependUserContext(messages) {
  return messages
}
export function appendSystemContext(systemPrompt) {
  return systemPrompt
}
`)
registerSourceStub('utils/attachments', `
export function createAttachmentMessage(attachment) {
  return { type: 'attachment', uuid: 'attachment-message', attachment }
}
export function filterDuplicateMemoryAttachments(attachments) {
  return attachments ?? []
}
export async function* getAttachmentMessages() {}
export function startRelevantMemoryPrefetch() {
  return {
    promise: Promise.resolve([]),
    settledAt: null,
    consumedOnIteration: -1,
    [Symbol.dispose]() {},
  }
}
`)
registerSourceStub('utils/messageQueueManager', `
export function remove() {}
export function getCommandsByMaxPriority() {
  return []
}
export function isSlashCommand() {
  return false
}
`)
registerSourceStub('utils/commandLifecycle', `
export function notifyCommandLifecycle() {}
`)
registerSourceStub('utils/headlessProfiler', `
export function headlessProfilerCheckpoint() {}
`)
registerSourceStub('utils/model/model', `
export function getRuntimeMainLoopModel({ mainLoopModel } = {}) {
  return mainLoopModel ?? 'deepseek-v4-pro'
}
export function renderModelName(model) {
  return model
}
`)
registerSourceStub('utils/model/modelOptions', `
export function getModelOptions() {
  return [
    { value: null, label: 'Default', description: 'Default Deep Code model' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'DeepSeek main coding model' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'DeepSeek fast coding model' },
  ]
}
`)
registerSourceStub('utils/effort', `
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max']
export function modelSupportsEffort(model) {
  return String(model ?? '').toLowerCase().startsWith('deepseek')
}
export function modelSupportsMaxEffort(model) {
  return String(model ?? '').toLowerCase().includes('pro')
}
export function resolveAppliedEffort(_model, effort) {
  return effort ?? 'max'
}
`)
registerSourceStub('utils/thinking', `
export function modelSupportsAdaptiveThinking(model) {
  return String(model ?? '').toLowerCase().startsWith('deepseek')
}
`)
registerSourceStub('utils/betas', `
export function modelSupportsAutoMode() {
  return false
}
`)
registerSourceStub('utils/fastMode', `
export function isFastModeSupportedByModel(model) {
  return String(model ?? '').toLowerCase().includes('flash')
}
`)
registerSourceStub('utils/tokens', `
export function doesMostRecentAssistantMessageExceed200k() {
  return false
}
export function finalContextTokensFromLastResponse() {
  return 0
}
export function tokenCountWithEstimation() {
  return 0
}
`)
registerSourceStub('utils/context', `
export const ESCALATED_MAX_TOKENS = 64000
export function has1mContext(model) {
  return String(model ?? '').toLowerCase().includes('[1m]')
}
export function is1mContextDisabled() {
  return false
}
export function modelSupports1M(model) {
  return String(model ?? '').toLowerCase().includes('sonnet') ||
    String(model ?? '').toLowerCase().includes('opus')
}
`)
registerSourceStub('utils/config', `
export function getGlobalConfig() {
  return globalThis.__deepcodeTuiHarness?.globalConfig ?? {}
}
`)
registerSourceStub('utils/featureFlags', `
export function getFeatureValue_CACHED_MAY_BE_STALE(_key, fallback) {
  return fallback
}
`)
registerSourceStub('tools/SleepTool/prompt', `
export const SLEEP_TOOL_NAME = 'Sleep'
`)
registerSourceStub('utils/hooks/postSamplingHooks', `
export async function executePostSamplingHooks() {}
`)
registerSourceStub('utils/hooks', `
export async function executeStopFailureHooks() {}
`)
registerSourceStub('services/api/dumpPrompts', `
export function createDumpPromptsFetch() {
  return undefined
}
`)
registerSourceStub('services/tools/StreamingToolExecutor', `
export class StreamingToolExecutor {
  addTool() {}
  discard() {}
  getCompletedResults() {
    return []
  }
  async *getRemainingResults() {}
}
`)
registerSourceStub('utils/queryProfiler', `
export function queryCheckpoint() {}
`)
registerSourceStub('services/tools/toolOrchestration', `
export async function* runTools(...args) {
  const harness = globalThis.__deepcodeTuiHarness
  if (harness?.runTools) {
    yield* harness.runTools(...args)
  }
}
`)
registerSourceStub('utils/toolResultStorage', `
export async function applyToolResultBudget(messages) {
  return messages
}
`)
registerSourceStub('utils/sessionStorage', `
export async function recordContentReplacement() {}
`)
registerSourceStub('query/stopHooks', `
export async function* handleStopHooks() {
  return { preventContinuation: false, blockingErrors: [] }
}
`)
registerSourceStub('query/config', `
export function buildQueryConfig() {
  return {
    sessionId: 'deepcode-test-session',
    gates: {
      streamingToolExecution: false,
      isAnt: false,
      fastModeEnabled: false,
      emitToolUseSummaries: false,
    },
  }
}
`)
registerSourceStub('query/deps', `
export function productionDeps() {
  return {
    uuid: () => 'deepcode-test-uuid',
    async microcompact(messages) {
      return { messages }
    },
    async autocompact() {
      return { compactionResult: null, consecutiveFailures: undefined }
    },
    async *callModel() {},
  }
}
`)
registerSourceStub('bootstrap/state', `
export function getInitialMainLoopModel() {
  return globalThis.__deepcodeTuiHarness?.initialMainLoopModel ?? null
}
export function getMainLoopModelOverride() {
  return globalThis.__deepcodeTuiHarness?.mainLoopModelOverride
}
export function getCurrentTurnTokenBudget() {
  return 0
}
export function getTurnOutputTokens() {
  return 0
}
export function getIsNonInteractiveSession() {
  return false
}
export function incrementBudgetContinuationCount() {}
`)
registerSourceStub('query/tokenBudget', `
export function createBudgetTracker() {
  return {}
}
export function checkTokenBudget() {
  return { action: 'stop' }
}
`)
registerSourceStub('utils/array', `
export function count(items, predicate) {
  return (items ?? []).filter(predicate).length
}
`)
registerSourceStub('utils/auth', `
export function getSubscriptionType() {
  return null
}
export function isClaudeAISubscriber() {
  return false
}
export function isMaxSubscriber() {
  return false
}
export function isProSubscriber() {
  return false
}
export function isTeamPremiumSubscriber() {
  return false
}
`)
registerSourceStub('utils/envUtils', `
export function isEnvTruthy(value) {
  return value === '1' || value === 'true'
}
`)
registerSourceStub('utils/model/modelStrings', `
export function getModelStrings() {
  return {
    opus40: 'claude-opus-4-20250514',
    opus41: 'claude-opus-4-1-20250805',
    opus45: 'claude-opus-4-5-20251101',
    opus46: 'claude-opus-4-6-20251201',
    sonnet35: 'claude-3-5-sonnet-20241022',
    sonnet37: 'claude-3-7-sonnet-20250219',
    sonnet40: 'claude-sonnet-4-20250514',
    sonnet45: 'claude-sonnet-4-5-20250929',
    sonnet46: 'claude-sonnet-4-6-20251201',
    haiku35: 'claude-3-5-haiku-20241022',
    haiku45: 'claude-haiku-4-5-20251001',
  }
}
export function resolveOverriddenModel(model) {
  return model
}
`)
registerSourceStub('utils/modelCost', `
export const COST_TIER_3_15 = {}
export const COST_HAIKU_35 = {}
export const COST_HAIKU_45 = {}
export function formatModelPricing() {
  return ''
}
export function getOpus46CostTier() {
  return ''
}
`)
registerSourceStub('utils/settings/settings', `
export function getSettings_DEPRECATED() {
  return globalThis.__deepcodeTuiHarness?.settings ?? {}
}
`)
registerSourceStub('utils/model/providers', `
export function getAPIProvider() {
  return globalThis.__deepcodeTuiHarness?.apiProvider ?? 'deepseek'
}
`)
registerSourceStub('utils/model/check1mAccess', `
export function checkOpus1mAccess() {
  return false
}
export function checkSonnet1mAccess() {
  return false
}
`)
registerSourceStub('constants/figures', `
export const LIGHTNING_BOLT = '⚡'
`)
registerSourceStub('utils/model/modelAllowlist', `
export function isModelAllowed() {
  return true
}
`)
registerSourceStub('utils/model/aliases', `
export function isModelAlias(model) {
  return ['opusplan', 'sonnet', 'haiku', 'opus', 'best'].includes(String(model).toLowerCase())
}
`)
registerSourceStub('utils/stringUtils', `
export function capitalize(value) {
  const text = String(value)
  return text.charAt(0).toUpperCase() + text.slice(1)
}
`)
stubModules.set('bun:bundle', `
export function feature() {
  return false
}
`)

export async function buildDeepSeekTuiQueryHarness() {
  return await buildDeepCodeSourceHarness(join(srcRoot, 'query.ts'))
}

export async function buildDeepSeekQueryDepsHarness() {
  return await buildDeepCodeSourceHarness(join(srcRoot, 'query/deps.ts'))
}

export async function buildDeepSeekModelHarness() {
  return await buildDeepCodeSourceHarness(join(srcRoot, 'utils/model/model.ts'))
}

export async function buildDeepSeekModelOptionsHarness() {
  return await buildDeepCodeSourceHarness(
    join(srcRoot, 'utils/model/modelOptions.ts'),
    {
      realSources: ['utils/model/model'],
    },
  )
}

export async function buildDeepSeekPrintModelInfoHarness() {
  return await buildDeepCodeSourceHarness(join(srcRoot, 'cli/printModelInfo.ts'), {
    realSources: ['utils/model/model'],
  })
}

async function buildDeepCodeSourceHarness(entrypoint, options = {}) {
  const outdir = await mkdtemp(join(tmpdir(), 'deepcode-tui-query-'))
  const outfile = join(outdir, 'query-harness.mjs')
  const build = await Bun.build({
    entrypoints: [entrypoint],
    format: 'esm',
    target: 'bun',
    sourcemap: 'none',
    plugins: [deepCodeSourceResolutionPlugin(options)],
  })

  if (!build.success) {
    throw new Error(build.logs.map(log => log.message).join('\n'))
  }

  const output = build.outputs.find(output => output.kind === 'entry-point')
  if (!output) {
    throw new Error('Bun.build did not produce a query harness entry point')
  }
  await Bun.write(outfile, output)

  return await import(pathToFileURL(outfile).href)
}

function deepCodeSourceResolutionPlugin(options = {}) {
  return {
    name: 'deepcode-source-resolution',
    setup(build) {
      build.onResolve({ filter: /^bun:bundle$/ }, () => ({
        path: 'bun:bundle',
        namespace: 'deepcode-stub',
      }))
      build.onResolve({ filter: /^src\// }, args =>
        resolveProjectImport(join(packageRoot, args.path), options),
      )
      build.onResolve({ filter: /^\./ }, args =>
        resolveProjectImport(resolve(dirname(args.importer), args.path), options),
      )
      build.onLoad({ filter: /.*/, namespace: 'deepcode-stub' }, args => ({
        contents: stubModules.get(args.path),
        loader: 'js',
      }))
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
        if (!args.path.startsWith(srcRoot)) return undefined
        let contents = readFileSync(args.path, 'utf8')
        if (contents.includes('bun:bundle')) {
          contents = contents
            .replace(/import\s+\{\s*feature\s*\}\s+from\s+['"]bun:bundle['"];?\n?/g, '')
            .replace(/\bfeature\([^)]*\)/g, 'false')
        }
        return {
          contents,
          loader: args.path.endsWith('.tsx') || args.path.endsWith('.jsx')
            ? 'tsx'
            : 'ts',
        }
      })
    },
  }
}

function resolveProjectImport(path, options = {}) {
  const resolvedPath = resolveSourcePath(path)
  const stubKey = sourceRelativePath(resolvedPath)
  if (stubModules.has(stubKey) && !shouldUseRealSource(stubKey, options)) {
    return { path: stubKey, namespace: 'deepcode-stub' }
  }
  return { path: resolvedPath }
}

function shouldUseRealSource(stubKey, options) {
  const baseKey = stubKey.replace(/\.(ts|tsx|js|mjs)$/, '')
  return (options.realSources ?? []).includes(baseKey)
}

function registerSourceStub(basePath, contents) {
  for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs']) {
    stubModules.set(`${basePath}${suffix}`, contents)
  }
  stubModules.set(join(basePath, 'index.ts'), contents)
  stubModules.set(join(basePath, 'index.tsx'), contents)
  stubModules.set(join(basePath, 'index.js'), contents)
}

function sourceRelativePath(path) {
  return relative(srcRoot, path).split('/').join('/')
}

function resolveSourcePath(path) {
  const candidates = candidatePaths(path)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return path
}

function candidatePaths(path) {
  if (path.endsWith('.js')) {
    const withoutJs = path.slice(0, -3)
    return [
      path,
      `${withoutJs}.ts`,
      `${withoutJs}.tsx`,
      join(withoutJs, 'index.ts'),
      join(withoutJs, 'index.tsx'),
      join(withoutJs, 'index.js'),
    ]
  }
  return [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.js`,
    `${path}.mjs`,
    join(path, 'index.ts'),
    join(path, 'index.tsx'),
    join(path, 'index.js'),
  ]
}
