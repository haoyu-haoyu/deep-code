import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
} from '../services/providers/deepseek.mjs'
import {
  createDeepSeekCacheDiagnostics,
  createDeepSeekPrefixHash,
  stableJsonStringify,
} from './deepseek-cache.mjs'
import { toolToDeepSeekFunctionSchema } from '../tools/deepseek-schema.mjs'

const DEFAULT_WARMUP_SYSTEM_PROMPT =
  [
    'You are Deep Code, a terminal AI coding assistant optimized for DeepSeek native APIs.',
    'This stable cache warm-up prefix defines the fixed Deep Code protocol surface: system instructions first, deterministic function tool manifest second, deterministic skills manifest third, stable repository summary fourth, stable conversation history fifth, and volatile user input last.',
    'No timestamps, request identifiers, random session identifiers, telemetry counters, or transient diagnostics belong in this stable prefix.',
  ].join(' ')

export async function createDeepSeekWarmupContext({
  systemPrompt = [DEFAULT_WARMUP_SYSTEM_PROMPT],
  tools = [],
  skills = [],
  repoSummary = '',
  stableHistory = [],
} = {}) {
  const stableTools = await createStableToolManifest(tools)
  const stableSkills = skills.map(skill => stableSkillManifest(skill))
  const prefixHash = createDeepSeekPrefixHash({
    systemPrompt,
    tools: stableTools,
    skills: stableSkills,
    repoSummary,
    stableHistory,
  })

  return {
    systemPrompt: [
      ...systemPrompt,
      stableTools.length > 0
        ? `Stable tool manifest:\n${stableJsonStringify(stableTools)}`
        : '',
      stableSkills.length > 0
        ? `Stable skills manifest:\n${stableJsonStringify(stableSkills)}`
        : '',
      repoSummary ? `Stable repo summary:\n${repoSummary}` : '',
    ].filter(Boolean),
    tools,
    prefixHash,
    stableTools,
    stableSkills,
    repoSummary,
    stableHistory,
  }
}

export async function warmDeepSeekCache({
  env = process.env,
  cwd = process.cwd(),
  provider,
  systemPrompt,
  tools = [],
  skills = [],
  repoSummary = '',
  stableHistory = [],
} = {}) {
  const context = await createDeepSeekWarmupContext({
    systemPrompt,
    tools,
    skills,
    repoSummary,
    stableHistory,
  })
  const request = await buildDeepSeekRequest({
    systemPrompt: context.systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Cache warm-up request. Reply exactly: ok',
      },
    ],
    tools,
    env,
    cwd,
    maxTokens: 8,
    thinking: 'disabled',
  })
  const modelProvider = provider ?? createDeepSeekProvider()
  const response = await collectDeepSeekStreamEvents(
    modelProvider.streamQuery(request),
  )

  return {
    prefixHash: context.prefixHash,
    content: response.content,
    finishReason: response.finishReason,
    usage: response.usage,
    cacheDiagnostics: response.usage
      ? createDeepSeekCacheDiagnostics(response.usage)
      : null,
    request,
  }
}

export function formatDeepSeekWarmupResult(result) {
  const diagnostics = result.cacheDiagnostics
  const hit = diagnostics?.promptCacheHitTokens ?? 0
  const miss = diagnostics?.promptCacheMissTokens ?? 0
  const hitRate = diagnostics
    ? `${(diagnostics.promptCacheHitRate * 100).toFixed(1)}%`
    : 'unknown'

  return [
    'DeepSeek cache warm-up',
    `Prefix hash: ${result.prefixHash}`,
    `Finish reason: ${result.finishReason ?? 'unknown'}`,
    `Response: ${JSON.stringify(result.content.trim())}`,
    `Cache: hit=${hit} miss=${miss} hit_rate=${hitRate}`,
  ].join('\n')
}

async function createStableToolManifest(tools) {
  const manifests = await Promise.all(
    [...tools]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(async tool => {
        const schema = await toolToDeepSeekFunctionSchema(tool)
        return {
          name: schema.function.name,
          description: schema.function.description,
          parameters: schema.function.parameters,
        }
      }),
  )
  return manifests
}

function stableSkillManifest(skill) {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
  }
}
