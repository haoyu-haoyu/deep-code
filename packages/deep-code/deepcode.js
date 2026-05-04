#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline/promises'
import {
  calculateDeepSeekCacheHitRate,
  collectDeepSeekStreamEvents,
  createDeepSeekCacheUserId,
  formatDeepSeekWarmupResult,
  resolveDeepSeekConfig,
  warmDeepSeekCache,
} from './src/deepcode/deepseek-native.mjs'
import {
  createDeepSeekDoctorReport,
  formatDeepSeekDoctorReport,
  hasFailingDoctorChecks,
} from './src/deepcode/doctor.mjs'
import { resolveModelProvider } from './src/services/providers/index.mjs'

const VERSION = '0.1.0-deepseek-native'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION)
    return
  }

  const settings = await loadSettings()
  const env = mergeSettingsEnv(process.env, settings)
  const config = resolveDeepSeekConfig({ env, cwd: process.cwd() })

  if (args.includes('--status')) {
    printStatus(config)
    return
  }
  if (args.includes('--doctor')) {
    const report = await createDeepSeekDoctorReport({
      env,
      cwd: process.cwd(),
      live: args.includes('--no-live') ? false : undefined,
    })
    console.log(formatDeepSeekDoctorReport(report))
    if (hasFailingDoctorChecks(report)) {
      process.exitCode = 1
    }
    return
  }
  if (args.includes('--warm-cache')) {
    const result = await warmDeepSeekCache({
      env,
      cwd: process.cwd(),
      repoSummary: await loadRepoSummary(),
    })
    console.log(formatDeepSeekWarmupResult(result))
    return
  }

  const prompt = await resolvePrompt(args)
  if (prompt) {
    await runSingleTurn(prompt, env)
    return
  }

  await runInteractive(env)
}

async function runSingleTurn(prompt, env) {
  const messages = [{ role: 'user', content: prompt }]
  const response = await requestDeepSeek(messages, env, { streamToStdout: true })
  if (!response.content.endsWith('\n')) process.stdout.write('\n')
  printUsage(response.usage)
}

async function runInteractive(env) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const messages = []
  console.log('Deep Code native DeepSeek session. Type /exit to quit.')
  while (true) {
    const prompt = await rl.question('deepcode> ')
    if (prompt.trim() === '/exit') break
    if (!prompt.trim()) continue
    messages.push({ role: 'user', content: prompt })
    const response = await requestDeepSeek(messages, env, {
      streamToStdout: true,
    })
    messages.push({
      role: 'assistant',
      content: response.content,
      reasoning_content:
        response.toolCalls.length > 0 ? response.reasoning : undefined,
      tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    })
    if (!response.content.endsWith('\n')) process.stdout.write('\n')
    printUsage(response.usage)
  }
  rl.close()
}

async function requestDeepSeek(messages, env, { streamToStdout = false } = {}) {
  const provider = resolveModelProvider({ env })
  return await collectDeepSeekStreamEvents(provider.streamQuery({
    systemPrompt: [
      'You are Deep Code, a terminal AI coding assistant optimized for DeepSeek. Answer concisely and do not call tools unless tools are provided.',
    ],
    messages,
    env,
    cwd: process.cwd(),
    maxTokens: Number(env.DEEPCODE_MAX_TOKENS ?? env.DEEPSEEK_MAX_TOKENS ?? 4096),
  }), {
    onContent: streamToStdout ? text => process.stdout.write(text) : undefined,
  })
}

async function resolvePrompt(args) {
  const nonFlagArgs = args.filter(arg => !arg.startsWith('-'))
  if (nonFlagArgs.length > 0) return nonFlagArgs.join(' ')
  if (!process.stdin.isTTY) {
    return await readStdin()
  }
  return ''
}

async function readStdin() {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }
  return input.trim()
}

async function loadSettings() {
  const path = join(homedir(), '.deepcode', 'settings.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`)
  }
}

async function loadRepoSummary() {
  const packageJsonPath = join(process.cwd(), 'package.json')
  if (!existsSync(packageJsonPath)) {
    return 'Deep Code workspace without package.json summary.'
  }
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    return JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      workspaces: pkg.workspaces,
    })
  } catch {
    return 'Deep Code workspace package summary unavailable.'
  }
}

function mergeSettingsEnv(env, settings) {
  const settingsEnv = settings.env ?? {}
  return {
    ...env,
    DEEPSEEK_API_KEY:
      env.DEEPSEEK_API_KEY ??
      env.DEEPCODE_API_KEY ??
      settingsEnv.DEEPSEEK_API_KEY ??
      settingsEnv.API_KEY,
    DEEPSEEK_BASE_URL:
      env.DEEPSEEK_BASE_URL ??
      env.DEEPCODE_BASE_URL ??
      settingsEnv.DEEPSEEK_BASE_URL ??
      settingsEnv.BASE_URL,
    DEEPSEEK_MODEL:
      env.DEEPSEEK_MODEL ??
      env.DEEPCODE_MODEL ??
      settingsEnv.DEEPSEEK_MODEL ??
      settingsEnv.MODEL,
    DEEPSEEK_THINKING:
      env.DEEPSEEK_THINKING ??
      env.DEEPCODE_THINKING ??
      (settings.thinkingEnabled === false ? 'disabled' : undefined),
    DEEPSEEK_REASONING_EFFORT:
      env.DEEPSEEK_REASONING_EFFORT ??
      env.DEEPCODE_REASONING_EFFORT ??
      settings.reasoningEffort,
    DEEPCODE_CACHE_USER_ID:
      env.DEEPCODE_CACHE_USER_ID ??
      settings.cacheUserId ??
      createDeepSeekCacheUserId(process.cwd()),
  }
}

function printStatus(config) {
  console.log(`Provider: DeepSeek native`)
  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Model: ${config.model}`)
  console.log(`Small model: ${config.smallModel}`)
  console.log(`Thinking: ${config.thinking}`)
  console.log(`Reasoning effort: ${config.reasoningEffort}`)
  console.log(`Cache user_id: ${config.cacheUserId}`)
  console.log(`API key: ${config.apiKey ? 'configured' : 'missing'}`)
}

function printUsage(usage) {
  if (!usage) return
  const hitRate = calculateDeepSeekCacheHitRate(usage)
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  process.stderr.write(
    `\n[DeepSeek cache] hit=${hit} miss=${miss} hit_rate=${(hitRate * 100).toFixed(1)}%\n`,
  )
}

function printHelp() {
  console.log(`Deep Code native DeepSeek CLI

Usage:
  deepcode "explain this repo"
  echo "summarize" | deepcode
  deepcode --status
  deepcode --doctor [--no-live]
  deepcode --warm-cache

Configuration:
  ~/.deepcode/settings.json
  DEEPSEEK_API_KEY / DEEPCODE_API_KEY
  DEEPSEEK_BASE_URL / DEEPCODE_BASE_URL
  DEEPSEEK_MODEL / DEEPCODE_MODEL
  DEEPSEEK_THINKING=enabled|disabled
  DEEPSEEK_REASONING_EFFORT=high|max
`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
