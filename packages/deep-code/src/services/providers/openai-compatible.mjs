import { assertModelProvider } from './types.mjs'

export const OPENAI_COMPATIBLE_PROVIDER_DEFAULTS = Object.freeze({
  ollama: Object.freeze({
    baseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    defaultModel: 'llama3.1',
  }),
  vllm: Object.freeze({
    baseUrl: '',
    requiresApiKey: false,
    defaultModel: '',
  }),
  'openai-compatible': Object.freeze({
    baseUrl: '',
    requiresApiKey: true,
    defaultModel: '',
  }),
})

const SUPPORTED_CAPABILITIES = new Set(['streaming', 'tool_calls'])

const UNSUPPORTED_CAPABILITIES = new Set([
  'cache_breakpoint',
  'cache_diagnostics',
  'extended_thinking',
  'reasoning_effort',
  'reasoning_content',
  'stable_prefix_cache',
  'strict_tool_schema',
  'strict_tools',
  'user_id',
])

export function createOpenAICompatibleProvider({
  providerName,
  baseUrl,
  apiKey,
  defaultModel,
} = {}) {
  const defaults = OPENAI_COMPATIBLE_PROVIDER_DEFAULTS[providerName]
  if (!defaults) {
    throw new Error(`Unknown OpenAI-compatible provider: ${providerName}`)
  }

  const resolvedBaseUrl = String(baseUrl || defaults.baseUrl).replace(/\/+$/, '')
  if (!resolvedBaseUrl) {
    throw new Error(`${providerName} requires a base URL`)
  }
  if (defaults.requiresApiKey && !apiKey) {
    throw new Error(`${providerName} requires an API key`)
  }

  const resolvedDefaultModel = defaultModel || defaults.defaultModel

  return assertModelProvider({
    name: providerName,

    async *streamQuery() {
      throw new Error('TODO P2.2.b registry integration: streamQuery is scaffolded')
    },

    buildRequest({
      messages = [],
      model,
      tools = [],
      stream = true,
      maxTokens,
      responseFormat,
      temperature,
      topP,
      toolChoice,
    } = {}) {
      const resolvedModel = model || resolvedDefaultModel
      if (!resolvedModel) {
        throw new Error(`${providerName} requires a model`)
      }

      return {
        method: 'POST',
        url: `${resolvedBaseUrl}/chat/completions`,
        headers: omitUndefined({
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : undefined,
        }),
        body: JSON.stringify(
          omitUndefined({
            model: resolvedModel,
            messages,
            stream,
            tools: tools.length ? tools : undefined,
            tool_choice: tools.length ? toolChoice ?? 'auto' : toolChoice,
            max_tokens: maxTokens,
            response_format: responseFormat,
            temperature,
            top_p: topP,
          }),
        ),
      }
    },

    parseStreamChunk(chunk) {
      return parseOpenAICompatibleStreamChunk(chunk)
    },

    mapUsage(usage) {
      return mapOpenAICompatibleUsage(usage)
    },

    supports(capability) {
      if (SUPPORTED_CAPABILITIES.has(capability)) return true
      if (UNSUPPORTED_CAPABILITIES.has(capability)) return false
      return false
    },
  })
}

export function parseOpenAICompatibleStreamChunk(chunk) {
  const text =
    typeof chunk === 'string'
      ? chunk
      : new TextDecoder().decode(chunk, { stream: false })

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue

    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '[DONE]') return null
    if (!payload) return null
    return JSON.parse(payload)
  }

  return null
}

export function mapOpenAICompatibleUsage(raw = {}) {
  return {
    input_tokens: raw?.prompt_tokens ?? 0,
    output_tokens: raw?.completion_tokens ?? 0,
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
}

function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  )
}
