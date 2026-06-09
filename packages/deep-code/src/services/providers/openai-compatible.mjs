import {
  // The OpenAI /chat/completions SSE wire format is the SUBSET that DeepSeek
  // extends (DeepSeek only ADDS reasoning_content), so the proven, #317-hardened
  // DeepSeek body streamer parses OpenAI chunks correctly — the reasoning_delta
  // branch simply never fires. Single source of truth (DRY); aliased to a
  // format-neutral name here.
  streamDeepSeekResponseBody as streamChatCompletionsBody,
} from './deepseek.mjs'
import { byteCompare } from '../../cache/byte-order.mjs'
import { mapMessagesToDeepSeek } from '../../messages/deepseek-normalizer.mjs'
import { toolToDeepSeekFunctionSchema } from '../../tools/deepseek-schema.mjs'
import { omitUndefined } from '../../utils/omitUndefined.mjs'
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

  // Extracted to a local const (not an inline method) so streamQuery can call
  // it directly without relying on `this`/the returned object's identity. Async
  // because tool-schema resolution is async (mirrors deepseek's buildRequest).
  const buildRequest = async ({
    systemPrompt = [],
    messages = [],
    model,
    tools = [],
    toolSchemaOptions = {},
    stream = true,
    maxTokens,
    responseFormat,
    temperature,
    topP,
    toolChoice,
  } = {}) => {
    const resolvedModel = model || resolvedDefaultModel
    if (!resolvedModel) {
      throw new Error(`${providerName} requires a model`)
    }

    // Convert the runtime's inputs into a chat-completions request, exactly as
    // buildDeepSeekRequest does — DeepSeek IS OpenAI-compatible, so the SHARED
    // normalizer/schema produce valid OpenAI output: systemPrompt → a leading
    // system message; internal messages → OpenAI role/content/tool_calls/tool
    // (reasoning replay OFF, since OpenAI has no reasoning_content); runtime
    // tool objects → OpenAI function schema (sorted for prefix stability). The
    // DeepSeek-only fields (thinking / reasoning_effort / user_id) are omitted.
    const chatMessages = [
      ...systemPromptToMessages(systemPrompt),
      ...mapMessagesToDeepSeek(messages, { reasoningReplay: false }),
    ]
    const functionTools = tools.length
      ? await Promise.all(
          [...tools]
            // byteCompare (NOT localeCompare): this manifest rides the cached prefix, so
            // its order must be locale-independent (see cache/byte-order.mjs).
            .sort((a, b) => byteCompare(a.name, b.name))
            .map(tool =>
              toolToDeepSeekFunctionSchema(tool, {
                ...toolSchemaOptions,
                tools: toolSchemaOptions.tools ?? tools,
              }),
            ),
        )
      : undefined

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
          messages: chatMessages,
          stream,
          // OpenAI-style servers only emit the final `usage` chunk in streaming
          // mode when the caller opts in via stream_options.include_usage.
          // Without it, no usage event arrives → token/cost accounting stays at
          // defaults. Only meaningful while streaming.
          stream_options: stream ? { include_usage: true } : undefined,
          tools: functionTools,
          tool_choice: functionTools ? toolChoice ?? 'auto' : toolChoice,
          max_tokens: maxTokens,
          response_format: responseFormat,
          temperature,
          top_p: topP,
        }),
      ),
    }
  }

  return assertModelProvider({
    name: providerName,

    // Accept either a pre-built request object (url+method+headers+body) or the
    // buildRequest() options — mirrors streamDeepSeekQuery's dual contract — then
    // fetch + yield normalized stream events.
    async *streamQuery(context = {}) {
      // A pre-built request carries url+method+headers+body; buildRequest options
      // (messages/model/…) never do. Discriminate on key PRESENCE, not
      // truthiness, so a valid-but-falsy body (e.g. '') isn't silently misrouted
      // back through buildRequest. buildRequest inputs take precedence so a
      // half-merged object (both shapes' keys) builds rather than fetching a
      // stray url.
      const isPrebuiltRequest =
        !('messages' in context) &&
        !('model' in context) &&
        'url' in context &&
        'method' in context &&
        'headers' in context &&
        'body' in context
      const request = isPrebuiltRequest ? context : await buildRequest(context)
      yield* streamOpenAICompatibleQuery(request, context)
    },

    buildRequest,

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

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

/**
 * Stream an OpenAI-compatible /chat/completions request, yielding the same
 * normalized stream-event vocabulary collectDeepSeekStreamEvents() assembles
 * (content_delta / tool_call_delta / finish / usage / done). The body parser is
 * shared with DeepSeek because the wire format is identical (see import note);
 * usage events therefore carry raw {prompt_tokens, completion_tokens}, while the
 * provider's mapUsage() exposes the Anthropic-shaped view for callers that want it.
 *
 * v1 is a single attempt with a connect-timeout (time-to-first-response, like
 * streamDeepSeekQuery) and the caller's abort signal forwarded for mid-stream
 * cancellation. Transient-failure retry is intentionally left to the caller —
 * DeepSeek's loop has its own retry; this keeps the unblocking change focused.
 *
 * @param {{url:string,method:string,headers:object,body:string|object}} request
 * @param {{fetch?:Function,signal?:AbortSignal,requestTimeoutMs?:number}} [context]
 */
export async function* streamOpenAICompatibleQuery(request, context = {}) {
  const fetchFn = context.fetch ?? globalThis.fetch
  if (typeof fetchFn !== 'function') {
    throw new Error(
      'openai-compatible streamQuery requires a fetch implementation',
    )
  }
  const timeoutMs = context.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()

  // Forward the caller's abort signal onto our controller so an external cancel
  // tears the request down (and fire immediately if it is already aborted).
  const userSignal = context.signal
  const onUserAbort = () => controller.abort()
  if (userSignal) {
    if (userSignal.aborted) controller.abort()
    else userSignal.addEventListener('abort', onUserAbort, { once: true })
  }

  try {
    let response
    try {
      response = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
        body:
          typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body),
      })
    } catch (error) {
      if (timedOut) {
        throw new Error(
          `openai-compatible request to ${request.url} timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    }

    // Connection established — cancel the connect-timeout BEFORE streaming the
    // body, so a legitimately long response isn't aborted mid-flight. The
    // caller's abort signal stays forwarded for explicit mid-stream cancel.
    clearTimeout(timer)

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `openai-compatible request to ${request.url} failed: ${response.status} ${response.statusText}${
          detail ? ` — ${detail.slice(0, 500)}` : ''
        }`,
      )
    }

    yield* streamChatCompletionsBody(response.body)
  } finally {
    clearTimeout(timer)
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort)
  }
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

// Mirror of deepseek.mjs's local systemPromptToMessages (the runtime passes the
// system prompt separately; OpenAI carries it as a leading system message).
function systemPromptToMessages(systemPrompt) {
  if (Array.isArray(systemPrompt)) {
    const content = systemPrompt.filter(Boolean).join('\n\n')
    return content ? [{ role: 'system', content }] : []
  }
  return systemPrompt ? [{ role: 'system', content: String(systemPrompt) }] : []
}
