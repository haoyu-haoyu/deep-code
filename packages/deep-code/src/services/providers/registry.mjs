import { createDeepSeekProvider } from './deepseek.mjs'
import { createUnsupportedProvider } from './types.mjs'

export const DEFAULT_MODEL_PROVIDER = 'deepseek'

export function resolveModelProvider({
  env = process.env,
  name = env.DEEPCODE_PROVIDER ?? env.DEEP_CODE_PROVIDER ?? DEFAULT_MODEL_PROVIDER,
  defaults = {},
} = {}) {
  const normalized = String(name || DEFAULT_MODEL_PROVIDER).toLowerCase()
  if (normalized === 'deepseek') {
    return createDeepSeekProvider(defaults)
  }

  if (normalized === 'anthropic' || normalized === 'claude') {
    return createUnsupportedProvider(
      'anthropic',
      'Anthropic provider is legacy-only in Deep Code native mode.',
    )
  }

  throw new Error(`Unknown model provider: ${name}`)
}
