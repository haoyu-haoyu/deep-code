#!/usr/bin/env node

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  calculateDeepSeekCacheHitRate,
  compactDeepCodeConversation,
  collectDeepSeekStreamEvents,
  createDeepSeekCacheUserId,
  createDeepCodeStablePrefix,
  formatDeepCodeCompactResult,
  formatDeepSeekWarmupResult,
  resolveDeepSeekConfig,
  warmDeepSeekCache,
} from './src/deepcode/deepseek-native.mjs'
import {
  createDeepSeekDoctorReport,
  formatDeepSeekDoctorReport,
  hasFailingDoctorChecks,
} from './src/deepcode/doctor.mjs'
import {
  recordDeepSeekCacheUsage,
  resolveDeepSeekCacheStatsPath,
} from './src/deepcode/cache-telemetry.mjs'
import {
  buildDeepCodeStatusReport,
  formatDeepCodeStatus,
} from './src/deepcode/status.mjs'
import {
  applyDeepCodeCliEnvOverrides,
  parseDeepCodeArgs,
} from './src/deepcode/cli-args.mjs'
import { runDeepSeekLocalToolChain } from './src/deepcode/local-toolchain.mjs'
import { resolveModelProvider } from './src/services/providers/index.mjs'

const VERSION = '0.1.0-deepseek-native'
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

async function main() {
  const cli = parseDeepCodeArgs(process.argv.slice(2))
  if (cli.command === 'help') {
    printHelp()
    return
  }
  if (cli.command === 'version') {
    console.log(`${VERSION} (Deep Code)`)
    return
  }

  const settings = await loadSettings()
  const env = mergeSettingsEnv(
    applyDeepCodeCliEnvOverrides(process.env, cli.envOverrides),
    settings,
  )
  const config = resolveDeepSeekConfig({ env, cwd: process.cwd() })
  const cacheStatsPath = resolveDeepSeekCacheStatsPath({ env, config })

  if (cli.command === 'status') {
    const repoSummary = await loadRepoSummary()
    console.log(formatDeepCodeStatus(await buildDeepCodeStatusReport({
      env,
      cwd: process.cwd(),
      repoSummary,
      cacheStatsPath,
    })))
    return
  }
  if (cli.command === 'doctor') {
    const report = await createDeepSeekDoctorReport({
      env,
      cwd: process.cwd(),
      live: cli.live ? undefined : false,
    })
    console.log(formatDeepSeekDoctorReport(report))
    if (hasFailingDoctorChecks(report)) {
      process.exitCode = 1
    }
    return
  }
  if (cli.command === 'warm-cache') {
    const repoSummary = await loadRepoSummary()
    const result = await warmDeepSeekCache({
      env,
      cwd: process.cwd(),
      repoSummary,
    })
    console.log(formatDeepSeekWarmupResult(result))
    await recordDeepSeekCacheUsage({
      path: cacheStatsPath,
      usage: result.usage,
      stablePrefix: await createDeepCodeStablePrefix({ repoSummary }),
    })
    return
  }
  if (cli.command === 'compact') {
    const repoSummary = await loadRepoSummary()
    const stablePrefix = await createDeepCodeStablePrefix({ repoSummary })
    const prompt = await resolvePrompt(cli.promptArgs)
    if (!prompt) {
      console.error('Error: --compact requires transcript text or piped stdin')
      process.exitCode = 1
      return
    }
    const result = await compactDeepCodeConversation({
      env,
      cwd: process.cwd(),
      stablePrefix,
      messages: [{ role: 'user', content: prompt }],
    })
    console.log(formatDeepCodeCompactResult(result))
    await recordDeepSeekCacheUsage({
      path: cacheStatsPath,
      usage: result.usage,
      stablePrefix,
    })
    return
  }
  if (cli.command === 'tool-e2e') {
    await runToolE2E(env, cacheStatsPath)
    return
  }

  await delegateToFullCli()
  return

  const repoSummary = await loadRepoSummary()
  const stablePrefix = await createDeepCodeStablePrefix({ repoSummary })
  const prompt = await resolvePrompt(cli.promptArgs)
  if (prompt) {
    await runSingleTurn(prompt, env, cacheStatsPath, stablePrefix)
    return
  }

  if (cli.printMode) {
    console.error('Error: -p/--print requires a prompt or piped stdin')
    process.exitCode = 1
    return
  }

  await runInteractive(env, cacheStatsPath, stablePrefix)
}

async function delegateToFullCli() {
  const fullCliPath = resolveFullCliPath()
  if (!existsSync(fullCliPath)) {
    console.error(
      `Deep Code full CLI bundle is missing at ${fullCliPath}.\n` +
        'Run: npm run build:full-cli --workspace @deepcode-ai/deep-code',
    )
    process.exitCode = 1
    return
  }

  const child = spawn(process.execPath, [
    fullCliPath,
    ...process.argv.slice(2),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPCODE_PROVIDER: process.env.DEEPCODE_PROVIDER ?? 'deepseek',
    },
    stdio: 'inherit',
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve(1)
        return
      }
      resolve(code ?? 1)
    })
  }).catch(error => {
    console.error(`Failed to launch Deep Code full CLI: ${error.message}`)
    return 1
  })
  process.exitCode = exitCode
}

function resolveFullCliPath() {
  return process.env.DEEPCODE_FULL_CLI_PATH ?? join(PACKAGE_DIR, 'dist', 'deepcode-full.mjs')
}

async function runSingleTurn(prompt, env, cacheStatsPath, stablePrefix) {
  const result = await runDeepSeekLocalToolChain({
    prompt,
    env,
    cwd: process.cwd(),
    repoSummary: stablePrefix?.repoSummary,
  })
  process.stdout.write(result.content)
  if (!result.content.endsWith('\n')) process.stdout.write('\n')
  await printAndRecordUsage(result.usage, cacheStatsPath, result.stablePrefix)
}

async function runInteractive(env, cacheStatsPath, stablePrefix) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const messages = []
  console.log('Deep Code native DeepSeek session. Type /exit to quit.')
  while (true) {
    const prompt = await rl.question('deepcode> ')
    if (prompt.trim() === '/exit') break
    if (prompt.trim() === '/compact') {
      if (messages.length === 0) {
        console.log('Nothing to compact.')
        continue
      }
      const result = await compactDeepCodeConversation({
        env,
        cwd: process.cwd(),
        stablePrefix,
        messages,
      })
      messages.splice(0, messages.length, ...result.messages)
      console.log(formatDeepCodeCompactResult(result))
      await recordDeepSeekCacheUsage({
        path: cacheStatsPath,
        usage: result.usage,
        stablePrefix,
      })
      continue
    }
    if (!prompt.trim()) continue
    messages.push({ role: 'user', content: prompt })
    const response = await requestDeepSeek(messages, env, {
      streamToStdout: true,
      stablePrefix,
    })
    messages.push({
      role: 'assistant',
      content: response.content,
      reasoning_content:
        response.toolCalls.length > 0 ? response.reasoning : undefined,
      tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    })
    if (!response.content.endsWith('\n')) process.stdout.write('\n')
    await printAndRecordUsage(response.usage, cacheStatsPath, stablePrefix)
  }
  rl.close()
}

async function requestDeepSeek(
  messages,
  env,
  { streamToStdout = false, stablePrefix } = {},
) {
  const provider = resolveModelProvider({ env })
  const prefix = stablePrefix ?? (await createDeepCodeStablePrefix())
  return await collectDeepSeekStreamEvents(provider.streamQuery({
    systemPrompt: prefix.systemPrompt,
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

async function printAndRecordUsage(usage, cacheStatsPath, stablePrefix) {
  if (!usage) return
  const hitRate = calculateDeepSeekCacheHitRate(usage)
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  process.stderr.write(
    `\n[DeepSeek cache] hit=${hit} miss=${miss} hit_rate=${(hitRate * 100).toFixed(1)}%\n`,
  )
  await recordDeepSeekCacheUsage({
    path: cacheStatsPath,
    usage,
    stablePrefix,
  })
}

async function runToolE2E(env, cacheStatsPath) {
  const cwd = await mkdtemp(join(tmpdir(), 'deepcode-tool-e2e-'))
  const samplePath = join(cwd, 'sample.txt')
  await writeFile(samplePath, 'alpha\n')
  const result = await runDeepSeekLocalToolChain({
    cwd,
    env,
    prompt: [
      'Use tools in this exact order:',
      '1. Read sample.txt.',
      '2. Edit sample.txt by replacing alpha with beta.',
      '3. Bash cat sample.txt.',
      '4. Read sample.txt again.',
      'Then answer exactly: tool-e2e-ok',
    ].join('\n'),
  })
  const finalContent = await readFile(samplePath, 'utf8')
  console.log('DeepSeek local toolchain E2E')
  console.log(`Workspace: ${cwd}`)
  console.log(`Model response: ${JSON.stringify(result.content.trim())}`)
  console.log(`File content: ${JSON.stringify(finalContent)}`)
  if (result.cacheDiagnostics) {
    console.log(
      `Cache: hit=${result.cacheDiagnostics.promptCacheHitTokens} miss=${result.cacheDiagnostics.promptCacheMissTokens} hit_rate=${(result.cacheDiagnostics.promptCacheHitRate * 100).toFixed(1)}%`,
    )
  }
  await recordDeepSeekCacheUsage({
    path: cacheStatsPath,
    usage: result.usage,
    stablePrefix: result.stablePrefix,
  })
  if (!finalContent.includes('beta')) {
    process.exitCode = 1
  }
}

function printHelp() {
  console.log(`Deep Code native DeepSeek CLI

Usage:
  deepcode "explain this repo"
  deepcode -p "explain this repo"
  echo "summarize" | deepcode
  deepcode --status
  deepcode --doctor [--no-live]
  deepcode --warm-cache
  deepcode --compact "summarize this transcript tail"
  deepcode --tool-e2e

Configuration:
  ~/.deepcode/settings.json
  DEEPSEEK_API_KEY / DEEPCODE_API_KEY
  DEEPSEEK_BASE_URL / DEEPCODE_BASE_URL
  DEEPSEEK_MODEL / DEEPCODE_MODEL
  DEEPSEEK_THINKING=enabled|disabled
  DEEPSEEK_REASONING_EFFORT=high|max

Options:
  -p, --print
  --api-key sk-...
  --provider deepseek
  --model deepseek-v4-pro
  --small-model deepseek-v4-flash
  --base-url https://api.deepseek.com
  --max-tokens 4096
  --thinking enabled|disabled
  --reasoning-effort high|max
  --cache-user-id dc_workspace
`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
