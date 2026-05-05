import {
  createDeepSeekPrefixHash,
  createStableHash,
  stableJsonStringify,
} from '../cache/deepseek-cache.mjs'
import { toolToDeepSeekFunctionSchema } from '../tools/deepseek-schema.mjs'

export const DEEPCODE_STABLE_SYSTEM_PROMPT = [
  'You are Deep Code, a terminal AI coding assistant optimized for DeepSeek native APIs.',
  'This stable cache prefix defines the fixed Deep Code protocol surface: system instructions first, deterministic function tool manifest second, deterministic skills manifest third, stable repository summary fourth, stable conversation history fifth, and volatile user input last.',
  'No timestamps, request identifiers, random session identifiers, telemetry counters, current user input, or transient diagnostics belong in this stable prefix.',
].join(' ')

export async function createDeepCodeStablePrefix({
  systemPrompt = [DEEPCODE_STABLE_SYSTEM_PROMPT],
  tools = [],
  toolSchemaOptions = {},
  skills = [],
  repoSummary = '',
  stableHistory = [],
} = {}) {
  const stableTools = await createStableToolManifest(tools, toolSchemaOptions)
  const stableSkills = skills
    .map(skill => stableSkillManifest(skill))
    .sort((a, b) => {
      const nameOrder = String(a.name).localeCompare(String(b.name))
      if (nameOrder !== 0) return nameOrder
      return String(a.path ?? '').localeCompare(String(b.path ?? ''))
    })
  const prefixHash = createDeepSeekPrefixHash({
    systemPrompt,
    tools: stableTools,
    skills: stableSkills,
    repoSummary,
    stableHistory,
  })
  const componentHashes = {
    systemPrompt: createStableHash(systemPrompt),
    tools: createStableHash(stableTools),
    skills: createStableHash(stableSkills),
    repoSummary: createStableHash(repoSummary),
    stableHistory: createStableHash(stableHistory),
  }

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
    componentHashes,
    stableTools,
    stableSkills,
    repoSummary,
    stableHistory,
  }
}

export function formatDeepCodePrefixStatus(prefix) {
  return `Stable prefix hash: ${prefix?.prefixHash ?? 'unknown'}`
}

async function createStableToolManifest(tools, toolSchemaOptions = {}) {
  const manifest = []
  for (const tool of tools) {
    const schema = await toolToDeepSeekFunctionSchema(tool, {
      ...toolSchemaOptions,
      tools: toolSchemaOptions.tools ?? tools,
    })
    manifest.push({
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters,
    })
  }

  return manifest.sort((a, b) => a.name.localeCompare(b.name))
}

function stableSkillManifest(skill) {
  if (typeof skill === 'string') return { name: skill }
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    version: skill.version,
  }
}
