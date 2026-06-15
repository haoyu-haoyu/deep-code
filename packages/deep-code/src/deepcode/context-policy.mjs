export const DEFAULT_DEEPCODE_CONTEXT_WINDOW_TOKENS = 1_000_000
export const DEFAULT_DEEPCODE_FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000
export const DEFAULT_DEEPCODE_COMPACT_RESERVED_OUTPUT_TOKENS = 20_000
export const DEFAULT_DEEPCODE_AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const DEFAULT_DEEPCODE_MAX_OUTPUT_TOKENS = 64_000
export const DEFAULT_DEEPCODE_MAX_OUTPUT_UPPER_LIMIT = 384_000

export function resolveDeepCodeContextPolicy({
  env = process.env,
  model = 'deepseek-v4-pro',
  autoCompactEnabled,
} = {}) {
  const contextWindowTokens = resolveContextWindowTokens({ env, model })
  const maxOutputTokens = resolveDeepCodeMaxOutputTokens({ env, model })
  const reservedOutputTokens = Math.min(
    maxOutputTokens.default,
    DEFAULT_DEEPCODE_COMPACT_RESERVED_OUTPUT_TOKENS,
  )
  const effectiveContextWindowTokens = Math.max(
    1,
    contextWindowTokens - reservedOutputTokens,
  )
  const autoCompactThresholdTokens = Math.max(
    1,
    effectiveContextWindowTokens - DEFAULT_DEEPCODE_AUTOCOMPACT_BUFFER_TOKENS,
  )
  const resolvedAutoCompactEnabled =
    autoCompactEnabled ??
    !(isEnvTruthy(env.DISABLE_COMPACT) || isEnvTruthy(env.DISABLE_AUTO_COMPACT))

  return {
    provider: 'DeepSeek native',
    model,
    contextWindowTokens,
    effectiveContextWindowTokens,
    reservedOutputTokens,
    autoCompactBufferTokens: DEFAULT_DEEPCODE_AUTOCOMPACT_BUFFER_TOKENS,
    autoCompactThresholdTokens,
    autoCompactEnabled: resolvedAutoCompactEnabled,
    supportsOneMillionContext:
      contextWindowTokens >= DEFAULT_DEEPCODE_CONTEXT_WINDOW_TOKENS,
    maxOutputTokens,
  }
}

export function formatDeepCodeContextPolicy(policy) {
  return [
    `Context window: ${policy.contextWindowTokens}`,
    `Effective context window: ${policy.effectiveContextWindowTokens}`,
    `Reserved output tokens: ${policy.reservedOutputTokens}`,
    `Auto compact: ${policy.autoCompactEnabled ? 'enabled' : 'disabled'}`,
    `Auto compact threshold: ${policy.autoCompactThresholdTokens}`,
    `Auto compact buffer: ${policy.autoCompactBufferTokens}`,
    `Max output tokens: default=${policy.maxOutputTokens.default} upper=${policy.maxOutputTokens.upperLimit}`,
  ].join('\n')
}

export function resolveDeepCodeMaxOutputTokens({
  env = process.env,
  model = 'deepseek-v4-pro',
} = {}) {
  const upperLimit =
    parsePositiveInteger(
      env.DEEPCODE_MAX_OUTPUT_TOKENS_UPPER_LIMIT ??
        env.DEEPSEEK_MAX_OUTPUT_TOKENS_UPPER_LIMIT,
    ) ??
    (isDeepSeekV4Model(model)
      ? DEFAULT_DEEPCODE_MAX_OUTPUT_UPPER_LIMIT
      : 64_000)
  const defaultTokens =
    parsePositiveInteger(
      env.DEEPCODE_DEFAULT_MAX_OUTPUT_TOKENS ??
        env.DEEPSEEK_DEFAULT_MAX_OUTPUT_TOKENS,
    ) ??
    (isDeepSeekV4Model(model) ? DEFAULT_DEEPCODE_MAX_OUTPUT_TOKENS : 32_000)

  return {
    default: Math.min(defaultTokens, upperLimit),
    upperLimit,
  }
}

export function resolveDeepCodeRequestMaxTokens({
  env = process.env,
  model = 'deepseek-v4-pro',
} = {}) {
  const requested = parsePositiveInteger(
    env.DEEPCODE_MAX_TOKENS ?? env.DEEPSEEK_MAX_TOKENS,
  )
  if (!requested) return undefined
  const { upperLimit } = resolveDeepCodeMaxOutputTokens({ env, model })
  return Math.min(requested, upperLimit)
}

export function isDeepCode1mContextDisabled(env = process.env) {
  return Boolean(
    isEnvTruthy(env.DEEPCODE_DISABLE_1M_CONTEXT) ||
      isEnvTruthy(env.DEEPSEEK_DISABLE_1M_CONTEXT) ||
      isEnvTruthy(env.CLAUDE_CODE_DISABLE_1M_CONTEXT),
  )
}

export function isDeepSeekModelName(model) {
  return normalizeModel(model).startsWith('deepseek')
}

export function isDeepSeekV4Model(model) {
  return normalizeModel(model).startsWith('deepseek-v4')
}

function resolveContextWindowTokens({ env, model }) {
  // Honor the legacy CLAUDE_CODE_ alias too. getContextWindowForModel
  // (utils/context.ts) clamps the runtime window with all three prefixes, so
  // without it this policy — which drives /status, the welcome banner, and
  // supportsOneMillionContext — would report 1M while the actual window is
  // capped. Mirrors isDeepCode1mContextDisabled's DEEPCODE_/DEEPSEEK_/CLAUDE_CODE_
  // chain.
  const override = parsePositiveInteger(
    env.DEEPCODE_MAX_CONTEXT_TOKENS ??
      env.DEEPSEEK_MAX_CONTEXT_TOKENS ??
      env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  )
  if (override) return override

  if (isDeepSeekV4Model(model) && !isDeepCode1mContextDisabled(env)) {
    return DEFAULT_DEEPCODE_CONTEXT_WINDOW_TOKENS
  }
  if (/\[1m\]/i.test(String(model ?? '')) && !isDeepCode1mContextDisabled(env)) {
    return DEFAULT_DEEPCODE_CONTEXT_WINDOW_TOKENS
  }
  return DEFAULT_DEEPCODE_FALLBACK_CONTEXT_WINDOW_TOKENS
}

function normalizeModel(model) {
  return String(model ?? '').trim().toLowerCase()
}

function parsePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function isEnvTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? ''))
}
