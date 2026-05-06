const COMMAND_FLAGS = new Map([
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
  ['--status', 'status'],
  ['--doctor', 'doctor'],
  ['--warm-cache', 'warm-cache'],
  ['--tool-e2e', 'tool-e2e'],
  ['--agent-e2e', 'agent-e2e'],
  ['--compact', 'compact'],
  ['--harness', 'harness'],
])

const ENV_OPTION_FLAGS = new Map([
  ['--api-key', 'DEEPSEEK_API_KEY'],
  ['--base-url', 'DEEPSEEK_BASE_URL'],
  ['--cache-user-id', 'DEEPCODE_CACHE_USER_ID'],
  ['--max-tokens', 'DEEPCODE_MAX_TOKENS'],
  ['--model', 'DEEPSEEK_MODEL'],
  ['--provider', 'DEEPCODE_PROVIDER'],
  ['--reasoning-effort', 'DEEPSEEK_REASONING_EFFORT'],
  ['--small-model', 'DEEPSEEK_SMALL_MODEL'],
  ['--thinking', 'DEEPSEEK_THINKING'],
  ['--harness-mode', 'DEEPCODE_HARNESS_MODE'],
  ['--harness-max-agents', 'DEEPCODE_HARNESS_MAX_AGENTS'],
  ['--max-context-tokens', 'DEEPCODE_MAX_CONTEXT_TOKENS'],
  ['--prompt-pack', 'DEEPCODE_PROMPT_PACK'],
  ['--strict-tools', 'DEEPCODE_STRICT_TOOLS'],
])

export function parseDeepCodeArgs(args = []) {
  const parsed = {
    command: null,
    printMode: false,
    promptArgs: [],
    envOverrides: {},
    live: true,
    unknownFlags: [],
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--') {
      parsed.promptArgs.push(...args.slice(index + 1))
      break
    }

    if (arg === '-p' || arg === '--print') {
      parsed.printMode = true
      continue
    }

    if (arg === '--no-live') {
      parsed.live = false
      continue
    }

    const command = COMMAND_FLAGS.get(arg)
    if (command) {
      parsed.command = command
      continue
    }

    const option = parseEnvOption(args, index, arg)
    if (option) {
      parsed.envOverrides[option.envKey] = option.value
      index = option.nextIndex
      continue
    }

    if (arg.startsWith('-')) {
      parsed.unknownFlags.push(arg)
      continue
    }

    parsed.promptArgs.push(arg)
  }

  return parsed
}

export function applyDeepCodeCliEnvOverrides(env = {}, overrides = {}) {
  return {
    ...env,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  }
}

function parseEnvOption(args, index, arg) {
  const equalsIndex = arg.indexOf('=')
  const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex)
  const envKey = ENV_OPTION_FLAGS.get(flag)
  if (!envKey) return null

  if (equalsIndex !== -1) {
    return {
      envKey,
      value: arg.slice(equalsIndex + 1),
      nextIndex: index,
    }
  }

  const value = args[index + 1]
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`${flag} requires a value`)
  }

  return {
    envKey,
    value,
    nextIndex: index + 1,
  }
}
