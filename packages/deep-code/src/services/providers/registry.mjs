import { createDeepSeekProvider } from './deepseek.mjs'
import { createOpenAICompatibleProvider } from './openai-compatible.mjs'
import { createUnsupportedProvider } from './types.mjs'

export const DEFAULT_MODEL_PROVIDER = 'deepseek'
export const MODEL_PROVIDER_NAMES = Object.freeze([
  'deepseek',
  'ollama',
  'vllm',
  'openai-compatible',
])

export function normalizeModelProviderName(name = DEFAULT_MODEL_PROVIDER) {
  return String(name || DEFAULT_MODEL_PROVIDER).trim().toLowerCase()
}

export function isModelProviderName(name) {
  return MODEL_PROVIDER_NAMES.includes(normalizeModelProviderName(name))
}

export function formatModelProviderNames() {
  return MODEL_PROVIDER_NAMES.join(', ')
}

export function resolveModelProvider({
  env = process.env,
  name = env.DEEPCODE_PROVIDER ?? env.DEEP_CODE_PROVIDER ?? DEFAULT_MODEL_PROVIDER,
  defaults = {},
  baseUrl,
  apiKey,
  defaultModel,
} = {}) {
  const normalized = normalizeModelProviderName(name)
  if (normalized === 'deepseek') {
    return createDeepSeekProvider(defaults)
  }

  if (
    normalized === 'ollama' ||
    normalized === 'vllm' ||
    normalized === 'openai-compatible'
  ) {
    return createOpenAICompatibleProvider({
      providerName: normalized,
      baseUrl: baseUrl ?? defaults.baseUrl,
      apiKey: apiKey ?? defaults.apiKey,
      defaultModel: defaultModel ?? defaults.defaultModel,
    })
  }

  if (normalized === 'anthropic' || normalized === 'claude') {
    return createUnsupportedProvider(
      'anthropic',
      'Anthropic provider is legacy-only in Deep Code native mode.',
    )
  }

  throw new Error(
    `Unknown model provider: ${name}. Valid providers: ${formatModelProviderNames()}`,
  )
}
