#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  buildDeepSeekRequest,
  calculateDeepSeekCacheHitRate,
  collectDeepSeekStreamEvents,
  createDeepCodeStablePrefix,
  createDeepSeekProvider,
  resolveDeepSeekConfig,
} from '../src/deepcode/deepseek-native.mjs'
import {
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from '../src/deepcode/cache-telemetry.mjs'

const REAL_E2E_FLAG = 'DEEPCODE_REAL_E2E'

async function main() {
  if (process.env[REAL_E2E_FLAG] !== '1') {
    console.log(
      'DeepSeek cache E2E skipped: set DEEPCODE_REAL_E2E=1 and configure DEEPSEEK_API_KEY, DEEPCODE_API_KEY, or ~/.deepcode/settings.json env to run live cache validation.',
    )
    return
  }

  const cwd = process.cwd()
  const env = mergeSettingsEnv(process.env, await loadDeepCodeSettings(process.env))
  const config = resolveDeepSeekConfig({ env, cwd })
  if (!config.apiKey) {
    console.error(
      'DeepSeek cache E2E failed: missing DEEPSEEK_API_KEY, DEEPCODE_API_KEY, or ~/.deepcode/settings.json env.',
    )
    process.exitCode = 1
    return
  }

  const stablePrefix = await createDeepCodeStablePrefix({
    repoSummary: createCacheE2ERepoSummary(),
  })
  const cacheStatsPath = resolveDeepSeekCacheStatsPath({ env, config })
  const provider = createDeepSeekProvider()
  const run1 = await runCacheRequest({ env, cwd, provider, stablePrefix })
  await recordDeepSeekCacheUsage({
    path: cacheStatsPath,
    usage: run1.usage,
    stablePrefix,
  })
  const run2 = await runCacheRequest({ env, cwd, provider, stablePrefix })
  await recordDeepSeekCacheUsage({
    path: cacheStatsPath,
    usage: run2.usage,
    stablePrefix,
  })

  console.log('DeepSeek cache E2E')
  console.log(`Stable prefix hash: ${stablePrefix.prefixHash}`)
  console.log(formatRun('Run 1', run1))
  console.log(formatRun('Run 2', run2))

  const secondHit = run2.usage?.prompt_cache_hit_tokens ?? 0
  if (secondHit <= 0) {
    console.error(
      'DeepSeek cache E2E failed: second request did not report prompt_cache_hit_tokens > 0.',
    )
    process.exitCode = 1
    return
  }

  console.log('DeepSeek cache E2E passed')
}

async function runCacheRequest({ env, cwd, provider, stablePrefix }) {
  const request = await buildDeepSeekRequest({
    systemPrompt: stablePrefix.systemPrompt,
    messages: [{
      role: 'user',
      content: 'Reply exactly: deepcode-cache-e2e-ok',
    }],
    env,
    cwd,
    maxTokens: 32,
    thinking: 'disabled',
    temperature: 0,
  })
  return await collectDeepSeekStreamEvents(provider.streamQuery(request))
}

function formatRun(label, result) {
  const usage = result.usage ?? {}
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  const rate = calculateDeepSeekCacheHitRate(usage)
  const content = JSON.stringify((result.content ?? '').trim())
  return `${label}: finish=${result.finishReason ?? 'unknown'} content=${content} hit=${hit} miss=${miss} hit_rate=${(rate * 100).toFixed(1)}%`
}

function createCacheE2ERepoSummary() {
  const paragraph = [
    'Deep Code cache E2E stable prefix.',
    'This deterministic project summary is intentionally repeated so DeepSeek context caching has a stable, reusable prefix unit.',
    'It contains no timestamps, request identifiers, random session identifiers, current user input, transient command output, or volatile telemetry.',
    'The same stable prefix must be reused across both live requests, while only cache telemetry is recorded after each response.',
  ].join(' ')

  return Array.from({ length: 16 }, () => paragraph).join('\n')
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
    DEEPSEEK_SMALL_MODEL: firstConfigured(
      env.DEEPSEEK_SMALL_MODEL,
      env.DEEPCODE_SMALL_MODEL,
      settingsEnv.DEEPSEEK_SMALL_MODEL,
      settingsEnv.DEEPCODE_SMALL_MODEL,
      settingsEnv.SMALL_MODEL,
    ),
  }
}

function firstConfigured(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0)
}

main().catch(error => {
  console.error(`DeepSeek cache E2E failed: ${error?.message ?? String(error)}`)
  process.exitCode = 1
})
