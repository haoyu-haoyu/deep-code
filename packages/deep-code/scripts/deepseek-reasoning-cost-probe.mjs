#!/usr/bin/env node

// Live, env-gated probe (NOT in CI) measuring the prompt-token cost of re-sending
// assistant reasoning_content on tool-call turns to DeepSeek. Inspired by
// Reasonix's realcache_test.go Probe 2 (~+500 prompt tokens/turn). Sends the SAME
// multi-turn tool transcript twice with reasoningReplay=true and twice with =false,
// warming then measuring the second of each pair, and reports the billed
// prompt/hit/miss delta — the data needed before ever flipping the default.
//
//   DEEPCODE_REAL_E2E=1 node scripts/deepseek-reasoning-cost-probe.mjs
//   (or: npm run test:reasoning-cost)

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  buildDeepSeekRequest,
  calculateDeepSeekCacheHitRate,
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
  resolveDeepSeekConfig,
} from '../src/deepcode/deepseek-native.mjs'

const REAL_E2E_FLAG = 'DEEPCODE_REAL_E2E'
const SETTLE_MS = 3000

async function main() {
  if (process.env[REAL_E2E_FLAG] !== '1') {
    console.log(
      'reasoning-cost probe skipped: set DEEPCODE_REAL_E2E=1 and configure DEEPSEEK_API_KEY (or ~/.deepcode/settings.json env) to run.',
    )
    return
  }

  const cwd = process.cwd()
  const env = mergeSettingsEnv(process.env, await loadDeepCodeSettings(process.env))
  const config = resolveDeepSeekConfig({ env, cwd })
  if (!config.apiKey) {
    console.error('reasoning-cost probe failed: missing DEEPSEEK_API_KEY / DEEPCODE_API_KEY.')
    process.exitCode = 1
    return
  }

  const provider = createDeepSeekProvider()
  const withReasoning = await measure({ env, cwd, provider, reasoningReplay: true })
  const withoutReasoning = await measure({ env, cwd, provider, reasoningReplay: false })

  console.log('DeepSeek reasoning_content cost probe')
  console.log(`model: ${config.model}`)
  console.log(`reasoning_content emitted by model on the probe turn: ${withReasoning.sawReasoning}`)
  console.log(formatRun('WITH reasoning re-send   ', withReasoning))
  console.log(formatRun('WITHOUT reasoning re-send', withoutReasoning))
  const delta = (withReasoning.usage?.prompt_tokens ?? 0) - (withoutReasoning.usage?.prompt_tokens ?? 0)
  console.log(`prompt_tokens delta (with - without) = ${delta}`)
  if (!withReasoning.sawReasoning) {
    console.log(
      'NOTE: the active model did not emit reasoning_content on the tool turn — the re-send knob has no cost to save here.',
    )
  }
}

// A fixed multi-turn tool transcript. Stable system head keeps the prefix warm;
// the assistant tool-call turn carries reasoning_content (the bytes under test).
function buildTranscript() {
  const stableHead = Array.from(
    { length: 24 },
    () =>
      'Deep Code reasoning-cost probe stable prefix. Deterministic, no timestamps or transient state, reused across both probe runs so only the reasoning re-send differs.',
  ).join('\n')
  return {
    systemPrompt: [{ type: 'text', text: stableHead }],
    tools: [
      {
        name: 'echo',
        description: 'echo back the input',
        inputJSONSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: [],
        },
      },
    ],
    messages: [
      { role: 'user', content: 'Investigate, call echo once, then reply.' },
      {
        role: 'assistant',
        content: '',
        reasoning_content:
          'Let me reason through this step by step before calling the tool. ' +
          'I will examine the request, decide echo is appropriate, and continue the same trajectory afterwards.',
        tool_calls: [
          { id: 'probe_call_1', type: 'function', function: { name: 'echo', arguments: '{"value":"x"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'probe_call_1', content: 'echoed: x' },
      { role: 'user', content: 'Reply exactly: deepcode-reasoning-probe-ok' },
    ],
  }
}

async function send({ env, cwd, provider, reasoningReplay }) {
  const t = buildTranscript()
  const request = await buildDeepSeekRequest({
    systemPrompt: t.systemPrompt,
    messages: t.messages,
    tools: t.tools,
    env,
    cwd,
    maxTokens: 32,
    thinking: 'disabled',
    temperature: 0,
    reasoningReplay,
  })
  const sentReasoning = (request.body.messages ?? []).some(
    m => m.role === 'assistant' && typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0,
  )
  const result = await collectDeepSeekStreamEvents(provider.streamQuery(request))
  return { result, sentReasoning }
}

async function measure({ env, cwd, provider, reasoningReplay }) {
  await send({ env, cwd, provider, reasoningReplay }) // warm
  await sleep(SETTLE_MS)
  const { result, sentReasoning } = await send({ env, cwd, provider, reasoningReplay }) // measure
  return { usage: result.usage, finishReason: result.finishReason, sawReasoning: sentReasoning }
}

function formatRun(label, run) {
  const u = run.usage ?? {}
  const hit = u.prompt_cache_hit_tokens ?? 0
  const miss = u.prompt_cache_miss_tokens ?? 0
  const rate = calculateDeepSeekCacheHitRate(u)
  return `${label}: prompt=${u.prompt_tokens ?? 0} hit=${hit} miss=${miss} hit_rate=${(rate * 100).toFixed(1)}%`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function loadDeepCodeSettings(env) {
  const configDir = env.DEEPCODE_CONFIG_DIR || join(homedir(), '.deepcode')
  const settingsPath = join(configDir, 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(await readFile(settingsPath, 'utf8'))
  } catch {
    return {}
  }
}

function mergeSettingsEnv(env, settings) {
  const settingsEnv = settings.env ?? {}
  return {
    ...env,
    DEEPSEEK_API_KEY: firstConfigured(
      env.DEEPSEEK_API_KEY,
      env.DEEPCODE_API_KEY,
      settingsEnv.DEEPSEEK_API_KEY,
      settingsEnv.DEEPCODE_API_KEY,
      settingsEnv.API_KEY,
    ),
    DEEPSEEK_BASE_URL: firstConfigured(
      env.DEEPSEEK_BASE_URL,
      env.DEEPCODE_BASE_URL,
      settingsEnv.DEEPSEEK_BASE_URL,
      settingsEnv.DEEPCODE_BASE_URL,
      settingsEnv.BASE_URL,
    ),
    DEEPSEEK_MODEL: firstConfigured(
      env.DEEPSEEK_MODEL,
      env.DEEPCODE_MODEL,
      settingsEnv.DEEPSEEK_MODEL,
      settingsEnv.DEEPCODE_MODEL,
      settingsEnv.MODEL,
    ),
  }
}

function firstConfigured(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0)
}

main().catch(error => {
  console.error(`reasoning-cost probe failed: ${error?.message ?? String(error)}`)
  process.exitCode = 1
})
