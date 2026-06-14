import { providerSupports } from '../../deepcode/provider-capabilities.mjs'
import { uncachedInputRemainder } from '../../deepcode/usageInputRemainder.mjs'

export type NonNullableUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  server_tool_use: {
    web_search_requests: number
    web_fetch_requests: number
  }
  service_tier: string
  cache_creation: {
    ephemeral_1h_input_tokens: number
    ephemeral_5m_input_tokens: number
  }
  inference_geo: string
  iterations: unknown[]
  speed: string
}

export const EMPTY_USAGE: Readonly<NonNullableUsage> = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  inference_geo: '',
  iterations: [],
  speed: 'standard',
}

export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  raw: unknown | undefined,
  { provider }: { provider?: { supports?: (capability: string) => boolean } } = {},
): NonNullableUsage {
  const source = isRecord(raw) ? raw : {}
  const cacheCreation = isRecord(source.cache_creation)
    ? source.cache_creation
    : {}
  const serverToolUse = isRecord(source.server_tool_use)
    ? source.server_tool_use
    : {}
  const supportsCache = providerSupports(provider, 'cache_breakpoint')

  const cacheRead = supportsCache
    ? firstNumber(
        source.cache_read_input_tokens,
        source.prompt_cache_hit_tokens,
      )
    : undefined
  const cacheCreationTokens = supportsCache
    ? firstNumber(
        source.cache_creation_input_tokens,
        source.prompt_cache_miss_tokens,
        cacheCreation.ephemeral_1h_input_tokens,
        cacheCreation.ephemeral_5m_input_tokens,
      )
    : undefined
  return {
    // The UNCACHED remainder (Anthropic contract), not the full prompt: a
    // provider that reports prompt_tokens (DeepSeek/OpenAI) gives the FULL
    // prompt, so summing it with the derived cache fields double-counts the
    // cached portion. uncachedInputRemainder also subsumes the old
    // cache-only inference (it returns 0 — the contract-correct remainder when
    // the whole prompt was cached — instead of the full hit+miss). See
    // usageInputRemainder.mjs.
    input_tokens:
      uncachedInputRemainder({
        inputTokens: firstNumber(source.input_tokens),
        promptTokens: firstNumber(source.prompt_tokens),
        cacheRead,
        cacheCreation: cacheCreationTokens,
      }) ?? usage.input_tokens,
    output_tokens:
      firstNumber(source.output_tokens, source.completion_tokens) ??
      usage.output_tokens,
    cache_creation_input_tokens:
      cacheCreationTokens ?? usage.cache_creation_input_tokens,
    cache_read_input_tokens: cacheRead ?? usage.cache_read_input_tokens,
    server_tool_use: {
      web_search_requests:
        firstNumber(serverToolUse.web_search_requests) ??
        usage.server_tool_use.web_search_requests,
      web_fetch_requests:
        firstNumber(serverToolUse.web_fetch_requests) ??
        usage.server_tool_use.web_fetch_requests,
    },
    service_tier:
      typeof source.service_tier === 'string'
        ? source.service_tier
        : usage.service_tier,
    cache_creation: {
      ephemeral_1h_input_tokens:
        (supportsCache
          ? firstNumber(cacheCreation.ephemeral_1h_input_tokens)
          : undefined) ??
        usage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        (supportsCache
          ? firstNumber(cacheCreation.ephemeral_5m_input_tokens)
          : undefined) ??
        usage.cache_creation.ephemeral_5m_input_tokens,
    },
    inference_geo:
      typeof source.inference_geo === 'string'
        ? source.inference_geo
        : usage.inference_geo,
    iterations: Array.isArray(source.iterations)
      ? source.iterations
      : [...usage.iterations],
    speed: typeof source.speed === 'string' ? source.speed : usage.speed,
  }
}

export function accumulateUsage(
  total: Readonly<NonNullableUsage>,
  message: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    input_tokens: total.input_tokens + message.input_tokens,
    output_tokens: total.output_tokens + message.output_tokens,
    cache_creation_input_tokens:
      total.cache_creation_input_tokens + message.cache_creation_input_tokens,
    cache_read_input_tokens:
      total.cache_read_input_tokens + message.cache_read_input_tokens,
    server_tool_use: {
      web_search_requests:
        total.server_tool_use.web_search_requests +
        message.server_tool_use.web_search_requests,
      web_fetch_requests:
        total.server_tool_use.web_fetch_requests +
        message.server_tool_use.web_fetch_requests,
    },
    service_tier: message.service_tier,
    cache_creation: {
      ephemeral_1h_input_tokens:
        total.cache_creation.ephemeral_1h_input_tokens +
        message.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        total.cache_creation.ephemeral_5m_input_tokens +
        message.cache_creation.ephemeral_5m_input_tokens,
    },
    inference_geo: message.inference_geo,
    iterations: message.iterations,
    speed: message.speed,
  }
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
