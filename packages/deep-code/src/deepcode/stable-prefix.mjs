import {
  createDeepSeekPrefixHash,
  createStableHash,
  stableJsonStringify,
} from '../cache/deepseek-cache.mjs'
import { byteCompare } from '../cache/byte-order.mjs'
import { toolToDeepSeekFunctionSchema } from '../tools/deepseek-schema.mjs'
import { resolveStrictToolNames } from '../tools/resolveStrictToolNames.mjs'
import { resolveStrictMode } from '../services/providers/resolveStrictMode.mjs'
import { providerSupports } from './provider-capabilities.mjs'

export const DEEPCODE_STABLE_SYSTEM_PROMPT = [
  'You are Deep Code, a terminal AI coding assistant optimized for DeepSeek native APIs.',
  'This stable cache prefix defines the fixed Deep Code protocol surface: system instructions first, deterministic function tool manifest second, deterministic skills manifest third, stable repository summary fourth, stable conversation history fifth, and volatile user input last.',
  'No timestamps, request identifiers, random session identifiers, telemetry counters, current user input, or transient diagnostics belong in this stable prefix.',
].join(' ')

/**
 * PREFIX-CACHE INVARIANT (DeepCode's core positioning).
 *
 * The assembled prefix — system instructions, tool manifest, skills manifest,
 * repo summary, and prior conversation history — must stay BYTE-IDENTICAL across
 * turns so DeepSeek's automatic prefix cache stays warm. Two rules enforce it:
 *
 *  1. Every turn only APPENDS new messages; an earlier message or the system
 *     prefix is never mutated in place. (Verified at the wire level by
 *     test/deepcode-native.test.mjs "request message-prefix byte-stable across
 *     tool turns" + its negative control.)
 *  2. All per-turn TRANSIENT state — attachments, <system-reminder>s, background
 *     notes, time/env — rides the volatile latest-user-message TAIL, never the
 *     cached prefix. (Verified by "transient per-turn content rides the message
 *     tail" in the same file.)
 *
 * Compaction is the ONLY sanctioned point at which the prefix changes; treat it
 * as a deliberate, rare cache reset, not a per-turn mutation.
 */
export async function createDeepCodeStablePrefix({
  systemPrompt = [DEEPCODE_STABLE_SYSTEM_PROMPT],
  tools = [],
  toolSchemaOptions = {},
  skills = [],
  repoSummary = '',
  stableHistory = [],
  provider,
  // Resolve the strict-tool mode the SAME way the wire does (default from
  // DEEPCODE_STRICT_TOOLS via resolveStrictMode), so the hashed manifest matches
  // the transmitted one. A caller may pass an explicit strictMode to mirror a
  // per-request strictTools boolean override. Defaults to 'off' in the common
  // case → byte-identical to the prior off-mode hash.
  strictMode,
  env = process.env,
} = {}) {
  if (!providerSupports(provider, 'stable_prefix_cache')) {
    return {
      systemPrompt: Array.isArray(systemPrompt) ? systemPrompt : [String(systemPrompt)],
      tools,
      prefixHash: '',
      componentHashes: {},
      stableTools: [],
      stableSkills: [],
      repoSummary,
      stableHistory,
      stablePrefixEnabled: false,
    }
  }

  const resolvedStrictMode = strictMode ?? resolveStrictMode({ env })
  const stableTools = await createStableToolManifest(
    tools,
    toolSchemaOptions,
    resolvedStrictMode,
  )
  const stableSkills = skills
    .map(skill => stableSkillManifest(skill))
    .sort((a, b) => {
      const nameOrder = byteCompare(a.name, b.name)
      if (nameOrder !== 0) return nameOrder
      return byteCompare(a.path ?? '', b.path ?? '')
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
    // NOTE: tool schemas are NOT rendered into the system prompt. They reach the
    // model ONLY via the native function-calling `tools` array (the sole tool
    // channel — incoming tool calls are read from `delta.tool_calls`, never parsed
    // from prose). A "Stable tool manifest:" text block used to be appended here
    // too, duplicating ~2-5k tokens of the cached prefix on every request for no
    // behavioral gain (live V4 probe: tool-call emission + selection identical with
    // and without it, on pro and flash). It was dropped to reclaim that window
    // budget. `stableTools` is still computed and fed into prefixHash below, so the
    // DeepCode prefix hash is byte-identical; only the redundant wire text is gone.
    // Skills + repo-summary stay — they have no native body-field equivalent.
    systemPrompt: [
      ...systemPrompt,
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

async function createStableToolManifest(
  tools,
  toolSchemaOptions = {},
  strictMode = 'off',
) {
  // Render each tool under the SAME per-tool strict selection the wire applies
  // (deepseek.mjs buildDeepSeekRequest), so prefixHash/componentHashes.tools
  // fingerprint the exact bytes sent. 'off' (the default) selects no tool, so the
  // strict:undefined per tool is byte-identical to the prior no-strict render.
  const strictToolNames = resolveStrictToolNames(strictMode, tools)
  const manifest = []
  for (const tool of tools) {
    const schema = await toolToDeepSeekFunctionSchema(tool, {
      ...toolSchemaOptions,
      strict: strictToolNames.has(tool.name ?? tool.function?.name)
        ? strictMode
        : undefined,
      tools: toolSchemaOptions.tools ?? tools,
    })
    const stableTool = {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters,
    }
    if (schema.function.strict === true) {
      stableTool.strict = true
    }
    manifest.push(stableTool)
  }

  return manifest.sort((a, b) => byteCompare(a.name, b.name))
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
