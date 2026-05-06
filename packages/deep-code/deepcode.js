#!/usr/bin/env node

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  formatDeepCodeAssistantChunk,
  formatDeepCodeCacheUsage,
  formatDeepCodeInfoPanel,
  formatDeepCodeTextPanel,
  formatDeepCodeWelcome,
} from './src/deepcode/welcome.mjs'
import {
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from './src/deepcode/harness-config.mjs'
import {
  formatDeepCodeHarnessRuntimeDecision,
  resolveDeepCodeHarnessRuntime,
} from './src/deepcode/harness-runtime.mjs'
import {
  createDeepCodeInteractiveReader,
  shouldForceNativeInteractive,
} from './src/deepcode/native-interactive.mjs'
import {
  applyDeepCodeCliEnvOverrides,
  parseDeepCodeArgs,
} from './src/deepcode/cli-args.mjs'
import { runDeepCodeAgentRuntimeE2E } from './src/deepcode/agent-runtime-e2e.mjs'
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
  if (cli.command === 'harness') {
    console.log(formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig(env)))
    const prompt = cli.promptArgs.join(' ').trim()
    if (prompt) {
      console.log('')
      console.log(formatDeepCodeHarnessRuntimeDecision(
        resolveDeepCodeHarnessRuntime({
          env,
          prompt,
          isMainAgent: true,
        }),
      ))
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
  if (cli.command === 'agent-e2e') {
    await runAgentE2E(env, cacheStatsPath)
    return
  }

  if (shouldDelegateToFullCli(cli, env)) {
    await delegateToFullCli()
    return
  }

  const repoSummary = await loadRepoSummary()
  const stablePrefix = await createDeepCodeStablePrefix({ repoSummary })
  const prompt = await resolvePrompt(cli.promptArgs, env)
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

function shouldDelegateToFullCli(cli, env = process.env) {
  if (env.DEEPCODE_EXPERIMENTAL_FULL_TUI === '1') return true
  if (!process.stdin.isTTY && !shouldForceNativeInteractive(env)) {
    return true
  }
  if (cli.printMode) return true
  if (cli.promptArgs.length > 0) return true
  if (cli.unknownFlags.length > 0) return true
  return false
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
  const messages = []
  const statusReport = await buildDeepCodeStatusReport({
    env,
    cwd: process.cwd(),
    repoSummary: stablePrefix?.repoSummary,
    cacheStatsPath,
    stablePrefix,
  })
  console.log(formatDeepCodeWelcome({
    version: VERSION,
    report: statusReport,
    cwd: process.cwd(),
    env,
  }))
  const reader = createDeepCodeInteractiveReader({
    input: process.stdin,
    output: process.stdout,
    env,
  })
  while (true) {
    const prompt = await reader.readLine()
    if (prompt === null) break
    if (prompt.trim() === '/exit') break
    if (prompt.trim() === '/status') {
      console.log(formatDeepCodeTextPanel('Status', formatDeepCodeStatus(await buildDeepCodeStatusReport({
        env,
        cwd: process.cwd(),
        repoSummary: stablePrefix?.repoSummary,
        cacheStatsPath,
        stablePrefix,
      }))))
      continue
    }
    if (prompt.trim() === '/model') {
      const config = resolveDeepSeekConfig({ env, cwd: process.cwd() })
      if (reader.supportsKeyMenus) {
        const selection = await reader.selectModel({ config })
        if (selection) {
          applyInteractiveModelSelection(env, selection)
          console.log(formatDeepCodeInfoPanel('Model updated', [
            { label: 'Main model', value: selection.model },
            { label: 'Reasoning effort', value: selection.reasoningEffort },
            { label: 'Scope', value: 'current session' },
          ]))
        }
        continue
      }
      console.log(formatDeepCodeInfoPanel('Model', [
        { label: 'Main model', value: config.model },
        { label: 'Small model', value: config.smallModel },
        { label: 'Thinking', value: config.thinking?.type ?? 'enabled' },
        { label: 'Reasoning effort', value: config.reasoningEffort },
        { label: 'Context window', value: '1M context' },
      ]))
      continue
    }
    if (prompt.trim() === '/doctor') {
      const report = await createDeepSeekDoctorReport({
        env,
        cwd: process.cwd(),
      })
      console.log(formatDeepCodeTextPanel('Doctor', formatDeepSeekDoctorReport(report)))
      continue
    }
    if (prompt.trim() === '/harness') {
      console.log(formatDeepCodeTextPanel('Harness', formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig(env))))
      continue
    }
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
  reader.close()
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
    onContent: streamToStdout
      ? text => process.stdout.write(formatDeepCodeAssistantChunk(text))
      : undefined,
  })
}

async function resolvePrompt(args, env = process.env) {
  const nonFlagArgs = args.filter(arg => !arg.startsWith('-'))
  if (nonFlagArgs.length > 0) return nonFlagArgs.join(' ')
  if (!process.stdin.isTTY && !shouldForceNativeInteractive(env)) {
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
    DEEPCODE_HARNESS_MODE:
      env.DEEPCODE_HARNESS_MODE ?? settings.harnessMode,
    DEEPCODE_HARNESS_MAX_AGENTS:
      env.DEEPCODE_HARNESS_MAX_AGENTS ?? settings.harnessMaxAgents,
    DEEPCODE_PROMPT_PACK:
      env.DEEPCODE_PROMPT_PACK ?? settings.promptPack,
    DEEPCODE_STRICT_TOOLS:
      env.DEEPCODE_STRICT_TOOLS ?? settings.strictTools,
  }
}

function applyInteractiveModelSelection(env, selection) {
  env.DEEPSEEK_MODEL = selection.model
  env.DEEPCODE_MODEL = selection.model
  env.DEEPSEEK_REASONING_EFFORT = selection.reasoningEffort
  env.DEEPCODE_REASONING_EFFORT = selection.reasoningEffort
}

async function printAndRecordUsage(usage, cacheStatsPath, stablePrefix) {
  if (!usage) return
  const hitRate = calculateDeepSeekCacheHitRate(usage)
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  process.stderr.write(
    `\n${formatDeepCodeCacheUsage({ hit, miss, hitRate })}\n`,
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

async function runAgentE2E(env, cacheStatsPath) {
  const result = await runDeepCodeAgentRuntimeE2E({
    env: {
      ...env,
      DEEPCODE_HARNESS_MODE: env.DEEPCODE_HARNESS_MODE ?? 'on',
    },
    cwd: process.cwd(),
  })
  console.log('DeepSeek Agent runtime E2E')
  console.log(`Runtime: ${result.runtimeDecision.state}`)
  console.log(`Runtime reason: ${result.runtimeDecision.reason}`)
  console.log(`Agent profile: ${result.lifecycle?.selectedProfile ?? 'unavailable'}`)
  console.log(`Agent selection: ${result.lifecycle?.selection ?? 'unavailable'}`)
  console.log(`Model response: ${JSON.stringify(result.content)}`)
  if (result.cacheDiagnostics) {
    console.log(
      `Cache: hit=${result.cacheDiagnostics.promptCacheHitTokens} miss=${result.cacheDiagnostics.promptCacheMissTokens} hit_rate=${(result.cacheDiagnostics.promptCacheHitRate * 100).toFixed(1)}%`,
    )
  }
  await recordDeepSeekCacheUsage({
    path: cacheStatsPath,
    usage: result.usage,
  })
  if (!result.ok) {
    process.exitCode = 1
  }
}

function printHelp() {
  console.log(`Deep Code native DeepSeek CLI

DeepSeek native models are used by default for print mode, TUI mode, tool calls, reasoning content, and cache diagnostics.

Usage:
  deepcode "explain this repo"
  deepcode -p "explain this repo"
  echo "summarize" | deepcode
  deepcode --status
  deepcode --doctor [--no-live]
  deepcode --harness
  deepcode --warm-cache
  deepcode --compact "summarize this transcript tail"
  deepcode --tool-e2e
  deepcode --agent-e2e

Configuration:
  ~/.deepcode/settings.json
  DEEPSEEK_API_KEY / DEEPCODE_API_KEY
  DEEPSEEK_BASE_URL / DEEPCODE_BASE_URL
  DEEPSEEK_MODEL / DEEPCODE_MODEL
  DEEPSEEK_THINKING=enabled|disabled
  DEEPSEEK_REASONING_EFFORT=high|max
  DEEPCODE_HARNESS_MODE=auto|off|on|swarm
  DEEPCODE_HARNESS_MAX_AGENTS=4
  DEEPCODE_MAX_CONTEXT_TOKENS=1000000
  DEEPCODE_PROMPT_PACK=deepseek-v1
  DEEPCODE_STRICT_TOOLS=off|safe|all

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
  --harness
  --harness-mode auto|off|on|swarm
  --harness-max-agents 4
  --max-context-tokens 1000000
  --prompt-pack deepseek-v1
  --strict-tools off|safe|all
`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
