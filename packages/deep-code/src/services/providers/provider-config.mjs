import {
  loadProviderConfigFile,
} from './deepseek-config-store.mjs'
import {
  OPENAI_COMPATIBLE_PROVIDER_DEFAULTS,
} from './openai-compatible.mjs'
import {
  DEFAULT_MODEL_PROVIDER,
  normalizeModelProviderName,
} from './registry.mjs'

const DEEPSEEK_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.deepseek.com',
  requiresApiKey: true,
  defaultModel: 'deepseek-v4-pro',
})

const PROVIDER_ENV = Object.freeze({
  deepseek: Object.freeze({
    apiKey: ['DEEPSEEK_API_KEY'],
    baseUrl: ['DEEPSEEK_BASE_URL'],
    model: ['DEEPSEEK_MODEL'],
  }),
  ollama: Object.freeze({
    apiKey: ['OLLAMA_API_KEY'],
    baseUrl: ['OLLAMA_BASE_URL'],
    model: ['OLLAMA_MODEL'],
  }),
  vllm: Object.freeze({
    apiKey: ['VLLM_API_KEY'],
    baseUrl: ['VLLM_BASE_URL'],
    model: ['VLLM_MODEL'],
  }),
  'openai-compatible': Object.freeze({
    apiKey: ['OPENAI_COMPATIBLE_API_KEY'],
    baseUrl: ['OPENAI_COMPATIBLE_BASE_URL'],
    model: ['OPENAI_COMPATIBLE_MODEL'],
  }),
})

const GENERIC_ENV = Object.freeze({
  apiKey: ['DEEPCODE_API_KEY', 'API_KEY'],
  baseUrl: ['DEEPCODE_BASE_URL'],
  model: ['DEEPCODE_MODEL'],
})

/**
 * The complete set of env var NAMES the provider config can resolve an API key
 * from — every provider in PROVIDER_ENV plus the generic GENERIC_ENV fallback.
 * Exported so the subprocess-env scrub set (subprocessEnvScrub.mjs) can be
 * drift-guarded against it: a new provider credential must also be scrubbed from
 * child environments or prompt injection could exfiltrate it.
 * @returns {string[]}
 */
export function getProviderCredentialEnvVars() {
  const names = new Set(GENERIC_ENV.apiKey)
  for (const cfg of Object.values(PROVIDER_ENV)) {
    for (const name of cfg.apiKey) names.add(name)
  }
  return [...names]
}

export function resolveProviderConfig({
  provider,
  env = process.env,
  cliBaseUrl,
  cliApiKey,
  cliModel,
  fileConfig,
} = {}) {
  const file = fileConfig ?? loadProviderConfigFile({ env })
  const resolvedProvider = normalizeModelProviderName(
    provider ??
      env.DEEPCODE_PROVIDER ??
      env.DEEP_CODE_PROVIDER ??
      file.activeProvider ??
      DEFAULT_MODEL_PROVIDER,
  )
  const providerFile = file.providers?.[resolvedProvider] ?? {}
  const defaults = getProviderDefaults(resolvedProvider)

  return {
    provider: resolvedProvider,
    baseUrl:
      firstDefined(
        cliBaseUrl,
        firstEnv(env, PROVIDER_ENV[resolvedProvider]?.baseUrl),
        firstEnv(env, GENERIC_ENV.baseUrl),
        providerFile.baseUrl,
        defaults.baseUrl,
      ) || undefined,
    apiKey:
      firstDefined(
        cliApiKey,
        firstEnv(env, PROVIDER_ENV[resolvedProvider]?.apiKey),
        firstEnv(env, GENERIC_ENV.apiKey),
        providerFile.apiKey,
      ) || undefined,
    defaultModel:
      firstDefined(
        cliModel,
        firstEnv(env, PROVIDER_ENV[resolvedProvider]?.model),
        firstEnv(env, GENERIC_ENV.model),
        providerFile.model,
        defaults.defaultModel,
      ) || undefined,
    requiresApiKey: defaults.requiresApiKey,
  }
}

export function getProviderDefaults(provider) {
  const normalized = normalizeModelProviderName(provider)
  if (normalized === 'deepseek') return DEEPSEEK_DEFAULTS
  const defaults = OPENAI_COMPATIBLE_PROVIDER_DEFAULTS[normalized]
  if (defaults) return defaults
  return Object.freeze({
    baseUrl: '',
    requiresApiKey: true,
    defaultModel: '',
  })
}

function firstEnv(env, keys = []) {
  for (const key of keys) {
    if (env[key]) return env[key]
  }
  return undefined
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null)
}
