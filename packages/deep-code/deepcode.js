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
  createDeepCodeTurnSpinner,
  shouldForceNativeInteractive,
} from './src/deepcode/native-interactive.mjs'
import {
  formatFullCliLaunchFailure,
  formatMissingFullCliMessage,
  forwardSignalsToChild,
  resolveFullCliExitCode,
  resolveFullCliPath,
  shouldDelegateToFullCli,
  shouldLaunchFullTui,
} from './src/deepcode/front-controller.mjs'
import {
  applyDeepCodeCliEnvOverrides,
  parseDeepCodeArgs,
} from './src/deepcode/cli-args.mjs'
import { runDeepCodeAgentRuntimeE2E } from './src/deepcode/agent-runtime-e2e.mjs'
import { runDeepSeekLocalToolChain } from './src/deepcode/local-toolchain.mjs'
import { readStdinWithTimeout, STDIN_PEEK_TIMEOUT_MS } from './src/deepcode/stdin.mjs'
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

  const settings = await loadSettings(process.env)
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

  if (shouldDelegateToFullCli({ cli, env, input: process.stdin })) {
    await delegateToFullCli(env, cli)
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

async function delegateToFullCli(env, cli) {
  const fullCliPath = resolveFullCliPath({ env, packageDir: PACKAGE_DIR })
  if (!existsSync(fullCliPath)) {
    console.error(formatMissingFullCliMessage(fullCliPath))
    process.exitCode = 1
    return
  }

  const child = spawn(process.execPath, [
    fullCliPath,
    ...process.argv.slice(2),
  ], {
    cwd: process.cwd(),
    env: {
      ...env,
      DEEPCODE_PROVIDER: env.DEEPCODE_PROVIDER ?? 'deepseek',
      ...(shouldLaunchFullTui({ cli, env, input: process.stdin })
        ? { DEEPCODE_FULL_TUI_SKIP_SETUP: env.DEEPCODE_FULL_TUI_SKIP_SETUP ?? '1' }
        : {}),
    },
    stdio: 'inherit',
  })

  // Forward SIGINT/SIGTERM/SIGHUP to the child so killing the wrapper tears
  // down the TUI child (which owns the terminal in raw mode) instead of
  // orphaning it; this also keeps the wrapper alive to await the child.
  const unforwardSignals = forwardSignalsToChild(child, process)
  let exitCode
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      // Preserve the child's real exit cause (128 + signum on a signal)
      // instead of masking it as 1, so `timeout`/CI see why it died.
      child.once('exit', (code, signal) => {
        resolve(resolveFullCliExitCode(code, signal))
      })
    })
  } catch (error) {
    console.error(formatFullCliLaunchFailure(error))
    exitCode = 1
  } finally {
    unforwardSignals()
  }
  process.exitCode = exitCode
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
  // A mid-turn Ctrl-C aborts the in-flight streaming op. The reader fires
  // onInterrupt only when no readLine is waiting (i.e. mid-turn). It returns
  // true iff an abortable op was in flight (so the reader drops the keypress);
  // otherwise false, so the reader queues the Ctrl-C and the next readLine
  // exits — the same escape the line-based reader gives, so a Ctrl-C during a
  // NON-abortable operation (e.g. a local slash command) is never lost.
  let currentTurnAbort = null
  const reader = createDeepCodeInteractiveReader({
    input: process.stdin,
    output: process.stdout,
    env,
    onInterrupt: () => {
      if (!currentTurnAbort) return false
      currentTurnAbort.abort()
      return true
    },
  })
  // Run a streaming op under a fresh per-turn AbortController. On success
  // returns { value }; on a Ctrl-C abort or a request failure it prints ^C (or
  // the error) and returns null so the caller returns to the prompt instead of
  // wedging/exiting. currentTurnAbort is cleared afterward so onInterrupt only
  // intercepts a Ctrl-C while an op is actually in flight.
  const runInterruptible = async op => {
    currentTurnAbort = new AbortController()
    try {
      return { value: await op(currentTurnAbort.signal) }
    } catch (error) {
      const aborted = currentTurnAbort.signal.aborted
      process.stdout.write('\n')
      if (aborted || error?.name === 'AbortError') {
        process.stdout.write('^C\n')
      } else {
        console.error(error?.message ?? String(error))
      }
      return null
    } finally {
      currentTurnAbort = null
    }
  }
  // Always restore the terminal: a thrown turn error (or any other escape from
  // the loop) must not skip reader.close() and leave the session wedged in raw
  // mode with no echo and a dead Ctrl-C.
  try {
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
        // /compact also streams a provider call — make it Ctrl-C-abortable too,
        // so a stuck compaction is recoverable (not just queued for exit).
        const compacted = await runInterruptible(signal =>
          compactDeepCodeConversation({
            env,
            cwd: process.cwd(),
            stablePrefix,
            messages,
            signal,
          }),
        )
        if (!compacted) continue
        const result = compacted.value
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
      // A failed or Ctrl-C-interrupted turn returns null; roll back the
      // unanswered user message (only it was pushed at this point, so pop is
      // exact) so the next turn isn't two consecutive user turns, and return to
      // the prompt. runInterruptible has already printed ^C (abort) or the
      // error (invalid key/401, network down, timeout).
      const turn = await runInterruptible(signal =>
        requestDeepSeek(messages, env, {
          streamToStdout: true,
          stablePrefix,
          signal,
        }),
      )
      if (!turn) {
        messages.pop()
        continue
      }
      const response = turn.value
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
  } finally {
    reader.close()
  }
}

async function requestDeepSeek(
  messages,
  env,
  { streamToStdout = false, stablePrefix, signal } = {},
) {
  const provider = resolveModelProvider({ env })
  const prefix = stablePrefix ?? (await createDeepCodeStablePrefix())
  const spinner = streamToStdout
    ? createDeepCodeTurnSpinner({
        output: process.stdout,
        env,
        message: 'DeepSeek reasoning',
      })
    : null
  let receivedContent = false
  if (spinner) spinner.start()
  try {
    return await collectDeepSeekStreamEvents(provider.streamQuery({
      systemPrompt: prefix.systemPrompt,
      messages,
      env,
      cwd: process.cwd(),
      maxTokens: Number(env.DEEPCODE_MAX_TOKENS ?? env.DEEPSEEK_MAX_TOKENS ?? 4096),
      // Per-turn abort: a mid-turn Ctrl-C aborts this signal (see runInteractive).
      signal,
    }), {
      onContent: streamToStdout
        ? text => {
            if (!receivedContent) {
              if (spinner) spinner.stop({ clear: true })
              receivedContent = true
            }
            process.stdout.write(formatDeepCodeAssistantChunk(text))
          }
        : undefined,
    })
  } finally {
    if (spinner) spinner.stop({ clear: true })
  }
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
  // Guard against an inherited-but-idle non-TTY stdin: without a peek timeout an
  // unbounded drain hangs the process forever (e.g. `deepcode --compact` spawned
  // with an open-but-idle stdin pipe). Mirrors the full-CLI peekForStdinData.
  try {
    return await readStdinWithTimeout(process.stdin, STDIN_PEEK_TIMEOUT_MS, {
      onTimeout: () =>
        process.stderr.write(
          'Warning: no stdin data received in 3s, proceeding without it. ' +
            'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n',
        ),
    })
  } finally {
    // Release stdin's hold on the event loop so an open-but-idle pipe can't keep
    // the process alive after we're done reading (the error/exit path sets
    // process.exitCode and returns rather than calling process.exit).
    process.stdin.unref?.()
  }
}

function resolveSettingsPath(env = process.env) {
  return join(env.DEEPCODE_CONFIG_DIR || join(homedir(), '.deepcode'), 'settings.json')
}

async function loadSettings(env = process.env) {
  const path = resolveSettingsPath(env)
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
      firstConfigured(
        env.DEEPSEEK_API_KEY,
        env.DEEPCODE_API_KEY,
        settingsEnv.DEEPSEEK_API_KEY,
        settingsEnv.API_KEY,
      ),
    DEEPSEEK_BASE_URL:
      firstConfigured(
        env.DEEPSEEK_BASE_URL,
        env.DEEPCODE_BASE_URL,
        settingsEnv.DEEPSEEK_BASE_URL,
        settingsEnv.BASE_URL,
      ),
    DEEPSEEK_MODEL:
      firstConfigured(
        env.DEEPSEEK_MODEL,
        env.DEEPCODE_MODEL,
        settingsEnv.DEEPSEEK_MODEL,
        settingsEnv.MODEL,
      ),
    DEEPSEEK_SMALL_MODEL:
      firstConfigured(
        env.DEEPSEEK_SMALL_MODEL,
        env.DEEPCODE_SMALL_MODEL,
        settingsEnv.DEEPSEEK_SMALL_MODEL,
        settingsEnv.SMALL_MODEL,
      ),
    DEEPSEEK_THINKING:
      firstConfigured(
        env.DEEPSEEK_THINKING,
        env.DEEPCODE_THINKING,
        settings.thinkingEnabled === false ? 'disabled' : undefined,
      ),
    DEEPSEEK_REASONING_EFFORT:
      firstConfigured(
        env.DEEPSEEK_REASONING_EFFORT,
        env.DEEPCODE_REASONING_EFFORT,
        settings.reasoningEffort,
      ),
    DEEPCODE_CACHE_USER_ID:
      firstConfigured(
        env.DEEPCODE_CACHE_USER_ID,
        settings.cacheUserId,
        createDeepSeekCacheUserId(process.cwd()),
      ),
    DEEPCODE_HARNESS_MODE:
      firstConfigured(env.DEEPCODE_HARNESS_MODE, settings.harnessMode),
    DEEPCODE_HARNESS_MAX_AGENTS:
      firstConfigured(env.DEEPCODE_HARNESS_MAX_AGENTS, settings.harnessMaxAgents),
    DEEPCODE_PROMPT_PACK:
      firstConfigured(env.DEEPCODE_PROMPT_PACK, settings.promptPack),
    DEEPCODE_STRICT_TOOLS:
      firstConfigured(env.DEEPCODE_STRICT_TOOLS, settings.strictTools),
  }
}

function firstConfigured(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '')
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
