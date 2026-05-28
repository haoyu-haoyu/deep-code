import {
  BUILT_IN_LSP_SERVERS,
  isCommandAvailable as defaultIsCommandAvailable,
} from '../../services/lsp/registry.mjs'
import {
  MODEL_PROVIDER_CAPABILITIES,
  resolveModelProvider,
} from '../../services/providers/index.mjs'
import {
  resolveProviderConfig,
} from '../../services/providers/provider-config.mjs'

const DEFAULT_NETWORK_TIMEOUT_MS = 1500

export async function runDoctorChecks({
  env = process.env,
  fetchImpl = globalThis.fetch,
  isCommandAvailable = defaultIsCommandAvailable,
  lspServers = BUILT_IN_LSP_SERVERS,
  providerConfig,
  resolveModelProviderFn = resolveModelProvider,
  resolveProviderConfigFn = resolveProviderConfig,
  timeoutMs = parseTimeoutMs(env.DEEPCODE_DOCTOR_TIMEOUT_MS),
} = {}) {
  const checks = []
  let config

  try {
    config = providerConfig ?? resolveProviderConfigFn({ env })
    checks.push(checkProviderRuntime(config, resolveModelProviderFn))
  } catch (error) {
    checks.push({
      name: 'Provider runtime',
      status: 'fail',
      message: `Provider config failed: ${safeErrorMessage(error)}`,
      hint: 'Run deepcode provider config or set a valid DEEPCODE_PROVIDER.',
    })
    config = {
      apiKey: undefined,
      baseUrl: undefined,
      defaultModel: undefined,
      provider: env.DEEPCODE_PROVIDER ?? 'deepseek',
      requiresApiKey: true,
    }
  }

  checks.push(checkApiKey(config))
  checks.push(await checkNetworkReachability({
    baseUrl: config.baseUrl,
    fetchImpl,
    timeoutMs,
  }))
  checks.push(checkModelAvailability(config, resolveModelProviderFn))
  checks.push(checkLspServers({ isCommandAvailable, lspServers, env }))

  return {
    checks,
    overall: summarizeDoctorChecks(checks),
  }
}

export function summarizeDoctorChecks(checks) {
  if (checks.some(check => check.status === 'fail')) return 'fail'
  if (checks.some(check => check.status === 'warn')) return 'warn'
  return 'ok'
}

export function formatDoctorChecksText(result) {
  const report = normalizeDoctorReport(result)
  const lines = [
    'Deep Code Doctor',
    `Overall: ${report.overall.toUpperCase()}`,
    '',
  ]

  for (const check of report.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    if (check.hint) lines.push(`  Hint: ${check.hint}`)
  }

  return `${lines.join('\n')}\n`
}

export function normalizeDoctorReport(result) {
  if (Array.isArray(result)) {
    return {
      checks: result,
      overall: summarizeDoctorChecks(result),
    }
  }

  const checks = Array.isArray(result?.checks) ? result.checks : []
  return {
    checks,
    overall: result?.overall ?? summarizeDoctorChecks(checks),
  }
}

export function redactApiKey(apiKey) {
  if (!apiKey) return ''
  const value = String(apiKey)
  if (value.length <= 8) return '<redacted>'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function checkProviderRuntime(config, resolveModelProviderFn) {
  if (!config.provider) {
    return {
      name: 'Provider runtime',
      status: 'fail',
      message: 'No provider configured',
      hint: 'Set DEEPCODE_PROVIDER or configure the provider store.',
    }
  }

  if (!isHttpUrl(config.baseUrl)) {
    return {
      name: 'Provider runtime',
      status: 'fail',
      message: `Invalid base URL for ${config.provider}`,
      hint: 'Set a DEEPCODE_BASE_URL or provider-specific base URL starting with http:// or https://.',
    }
  }

  try {
    resolveModelProviderFn({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      name: config.provider,
    })
  } catch (error) {
    return {
      name: 'Provider runtime',
      status: 'fail',
      message: safeErrorMessage(error),
      hint: 'Fix provider base URL, API key, or model settings.',
    }
  }

  return {
    name: 'Provider runtime',
    status: 'ok',
    message: `${config.provider} provider configured`,
  }
}

function checkApiKey(config) {
  if (!config.requiresApiKey && !config.apiKey) {
    return {
      name: 'API key',
      status: 'ok',
      message: `${config.provider} does not require an API key`,
    }
  }

  if (!config.apiKey) {
    return {
      name: 'API key',
      status: 'fail',
      message: 'Missing API key',
      hint: 'Set DEEPSEEK_API_KEY, DEEPCODE_API_KEY, or API_KEY.',
    }
  }

  const value = String(config.apiKey)
  if (value.trim() !== value || /\s/.test(value) || value.length < 10) {
    return {
      name: 'API key',
      status: 'warn',
      message: `Configured but format looks unusual (${redactApiKey(value)})`,
      hint: 'Check for whitespace or an incomplete copied key.',
    }
  }

  return {
    name: 'API key',
    status: 'ok',
    message: `Configured (${redactApiKey(value)})`,
  }
}

async function checkNetworkReachability({ baseUrl, fetchImpl, timeoutMs }) {
  if (!isHttpUrl(baseUrl)) {
    return {
      name: 'Network',
      status: 'fail',
      message: 'Cannot check network because provider base URL is invalid',
    }
  }

  if (typeof fetchImpl !== 'function') {
    return {
      name: 'Network',
      status: 'warn',
      message: 'Fetch is unavailable; network check skipped',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(baseUrl, {
      method: 'HEAD',
      signal: controller.signal,
    })
    const status = Number(response?.status ?? 0)
    if ((response?.ok === true) || (status >= 200 && status < 500)) {
      return {
        name: 'Network',
        status: 'ok',
        message: `Reachable (${status || 'ok'})`,
      }
    }
    return {
      name: 'Network',
      status: 'warn',
      message: `Endpoint returned HTTP ${status || 'unknown'}`,
      hint: 'Check network connectivity and provider service status.',
    }
  } catch (error) {
    return {
      name: 'Network',
      status: 'warn',
      message: `DeepSeek API endpoint unreachable: ${safeErrorMessage(error)}`,
      hint: 'The CLI can still run offline; retry when network access is available.',
    }
  } finally {
    clearTimeout(timer)
  }
}

function checkModelAvailability(config, resolveModelProviderFn) {
  if (!config.defaultModel) {
    return {
      name: 'Model',
      status: 'fail',
      message: 'No model configured',
      hint: 'Set DEEPCODE_MODEL or the provider-specific model variable.',
    }
  }

  try {
    const provider = resolveModelProviderFn({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      name: config.provider,
    })
    const missing = [
      MODEL_PROVIDER_CAPABILITIES.STREAMING,
      MODEL_PROVIDER_CAPABILITIES.TOOL_CALLS,
    ].filter(capability => !provider.supports(capability))

    if (missing.length > 0) {
      return {
        name: 'Model',
        status: 'fail',
        message: `${config.defaultModel} missing capabilities: ${missing.join(', ')}`,
      }
    }

    return {
      name: 'Model',
      status: 'ok',
      message: `${config.defaultModel} supports streaming/tool calls`,
    }
  } catch (error) {
    return {
      name: 'Model',
      status: 'fail',
      message: `Model check failed: ${safeErrorMessage(error)}`,
    }
  }
}

function checkLspServers({ env, isCommandAvailable, lspServers }) {
  const commands = [...new Set(
    Object.values(lspServers)
      .map(server => server?.command)
      .filter(Boolean),
  )].sort()
  const missing = []

  for (const command of commands) {
    try {
      if (!isCommandAvailable(command, env.PATH || '')) missing.push(command)
    } catch {
      missing.push(command)
    }
  }

  if (missing.length > 0) {
    return {
      name: 'LSP servers',
      status: 'warn',
      message: `Missing optional LSP binaries: ${missing.join(', ')}`,
      hint: 'LSP diagnostics silently degrade until the relevant server binaries are installed.',
    }
  }

  return {
    name: 'LSP servers',
    status: 'ok',
    message: `${commands.length} built-in LSP server command(s) available`,
  }
}

function parseTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NETWORK_TIMEOUT_MS
}

function isHttpUrl(value) {
  return /^https?:\/\//.test(String(value || ''))
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown error')
}
