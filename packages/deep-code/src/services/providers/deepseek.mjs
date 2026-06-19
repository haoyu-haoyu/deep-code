import { randomUUID } from 'node:crypto'
import {
  MODEL_PROVIDER_CAPABILITIES,
  assertModelProvider,
} from './types.mjs'
import {
  createDeepSeekCacheUserId,
} from '../../cache/deepseek-cache.mjs'
import { byteCompare } from '../../cache/byte-order.mjs'
import { omitUndefined } from '../../utils/omitUndefined.mjs'
import { resolveToolCallIndex } from '../toolCallIndex.mjs'
import { firstNonEmpty } from '../../utils/configValue.mjs'
import { isAutoModelSetting } from '../../utils/model/autoModelSetting.mjs'
import { abortableDelay, abortReason } from '../../utils/abortableDelay.mjs'
import {
  mapMessagesToDeepSeek,
  normalizeToolCalls,
  stringifyToolResultContent,
} from '../../messages/deepseek-normalizer.mjs'
import { cachedToolToDeepSeekFunctionSchema } from './deepseek-tool-manifest-cache.mjs'
import { resolveStrictToolNames } from '../../tools/resolveStrictToolNames.mjs'
import { resolveStrictMode } from './resolveStrictMode.mjs'
import {
  mapDeepSeekHttpError,
  isFlashDowngradeStrategy,
  downgradeDeepSeekRetryBody,
} from './deepseek-recovery.mjs'
import { loadDeepSeekConfigFile } from './deepseek-config-store.mjs'
import { coerceDeepSeekEffort } from './deepseekEffort.mjs'

export { mapMessagesToDeepSeek } from '../../messages/deepseek-normalizer.mjs'
export {
  calculateDeepSeekCacheHitRate,
  createDeepSeekCacheDiagnostics,
  createDeepSeekCacheUserId,
  createDeepSeekPrefixHash,
  createStableHash,
  stableJsonStringify,
} from '../../cache/deepseek-cache.mjs'
export {
  sanitizeSchemaForDeepSeekStrict,
  toolToDeepSeekFunctionSchema,
} from '../../tools/deepseek-schema.mjs'
export {
  DEEPSEEK_FINISH_ACTIONS,
  mapDeepSeekFinishReason,
  mapDeepSeekHttpError,
} from './deepseek-recovery.mjs'

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro'
export const DEFAULT_DEEPSEEK_SMALL_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_PROVIDER_CAPABILITIES = Object.freeze([
  MODEL_PROVIDER_CAPABILITIES.CACHE_DIAGNOSTICS,
  MODEL_PROVIDER_CAPABILITIES.JSON_OUTPUT,
  MODEL_PROVIDER_CAPABILITIES.REASONING_CONTENT,
  MODEL_PROVIDER_CAPABILITIES.STRICT_TOOLS,
  MODEL_PROVIDER_CAPABILITIES.STREAMING,
  MODEL_PROVIDER_CAPABILITIES.TOOL_CALLS,
])

// Normalize a thinking/reasoning toggle to 'enabled' | 'disabled'. The boolean was
// previously derived with `thinkingType !== 'disabled'`, which treats EVERY value
// except the literal lowercase 'disabled' as enabled — so DEEPSEEK_THINKING=false
// (or 0/no/off, or `deepcode --thinking=false`) left reasoning ON, the opposite of
// intent (burning reasoning tokens and forcing temperature/top_p off). Mirror the
// envBool/normalizeDeepSeekEffort normalization already used in this file: map the
// common disable spellings to 'disabled', everything else (incl. 'enabled' and the
// commander 'adaptive') to 'enabled'. Unset/empty → 'enabled' (the default).
export function normalizeDeepSeekThinking(value) {
  if (value === undefined || value === null || value === '') return 'enabled'
  const normalized = String(value).trim().toLowerCase()
  if (['disabled', 'disable', 'false', '0', 'no', 'off'].includes(normalized)) {
    return 'disabled'
  }
  return 'enabled'
}

// Treat the 'auto' routing sentinel as absent so firstNonEmpty skips it (see the
// model/smallModel chains below). A non-auto value passes through unchanged.
function dropAuto(value) {
  return isAutoModelSetting(value) ? undefined : value
}

export function resolveDeepSeekConfig({
  env = process.env,
  cwd = process.cwd(),
  overrides = {},
  fileConfig,
} = {}) {
  const file = fileConfig === undefined ? loadDeepSeekConfigFile({ env }) : fileConfig
  const thinkingType =
    overrides.thinking ??
    env.DEEPSEEK_THINKING ??
    env.DEEPCODE_THINKING ??
    file?.thinking ??
    'enabled'
  const thinkingEnabled = normalizeDeepSeekThinking(thinkingType) !== 'disabled'

  return {
    // firstNonEmpty (not ??): an empty-string key env var (e.g.
    // `export DEEPSEEK_API_KEY=` in a wrapper, or an inherited-but-blanked CI
    // var) is not nullish, so the old `??` chain stopped at '' and shadowed a
    // valid /login key saved on disk — every request then went out with NO
    // Authorization header (DeepSeek 401). The model/baseUrl siblings below
    // already use firstNonEmpty for the same reason. Unset/valid env is
    // byte-identical, and apiKey is a header, not part of the cached prefix.
    apiKey: firstNonEmpty(
      overrides.apiKey,
      env.DEEPSEEK_API_KEY,
      env.DEEPCODE_API_KEY,
      env.API_KEY,
      file?.apiKey,
    ),
    // firstNonEmpty (not ??): an empty-string env var (DEEPSEEK_MODEL="") must fall through
    // to the default, not become a broken model:''/baseUrl:'' in the request. Unset env →
    // the default, byte-identical to the old `?? ` chain (the cache-prefix default path).
    baseUrl: stripTrailingSlash(
      firstNonEmpty(
        overrides.baseUrl,
        env.DEEPSEEK_BASE_URL,
        env.DEEPCODE_BASE_URL,
        file?.baseUrl,
        DEFAULT_DEEPSEEK_BASE_URL,
      ),
    ),
    // dropAuto: the 'auto' sentinel is per-turn flash/pro routing resolved
    // upstream (messageSend resolveAutoRoute), NOT a model name. A stray 'auto'
    // (a caller's model arg, DEEPSEEK_MODEL=auto, or a config file) must NOT reach
    // body.model as a phantom model — it is skipped here so the chain falls
    // through to the next concrete candidate (or the concrete default). The
    // common path (a real model, or all-unset → default) is byte-identical.
    model: firstNonEmpty(
      dropAuto(overrides.model),
      dropAuto(env.DEEPSEEK_MODEL),
      dropAuto(env.DEEPCODE_MODEL),
      dropAuto(file?.model),
      DEFAULT_DEEPSEEK_MODEL,
    ),
    smallModel: firstNonEmpty(
      dropAuto(overrides.smallModel),
      dropAuto(env.DEEPSEEK_SMALL_MODEL),
      dropAuto(env.DEEPCODE_SMALL_MODEL),
      dropAuto(file?.smallModel),
      DEFAULT_DEEPSEEK_SMALL_MODEL,
    ),
    thinking: thinkingEnabled ? 'enabled' : 'disabled',
    reasoningEffort: normalizeDeepSeekEffort(
      overrides.reasoningEffort ??
        env.DEEPSEEK_REASONING_EFFORT ??
        env.DEEPCODE_REASONING_EFFORT ??
        env.CLAUDE_CODE_EFFORT_LEVEL ??
        file?.reasoningEffort ??
        'max',
    ),
    cacheUserId:
      overrides.cacheUserId ??
      env.DEEPCODE_CACHE_USER_ID ??
      env.DEEPSEEK_CACHE_USER_ID ??
      createDeepSeekCacheUserId(cwd),
    // Re-send assistant reasoning_content on tool-call turns. Default true keeps
    // DeepSeek's reasoning-trajectory continuation (deepseekHarnessPrompts). Flip
    // to false only after a live cost probe (scripts/deepseek-reasoning-cost-probe.mjs).
    reasoningReplay:
      overrides.reasoningReplay ??
      envBool(env.DEEPCODE_REASONING_REPLAY ?? env.DEEPSEEK_REASONING_REPLAY) ??
      file?.reasoningReplay ??
      true,
  }
}

function envBool(value) {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  return undefined
}

export async function buildDeepSeekRequest({
  systemPrompt = [],
  messages = [],
  tools = [],
  env = process.env,
  cwd = process.cwd(),
  model,
  maxTokens,
  stream = true,
  strictTools,
  thinking,
  reasoningEffort,
  temperature,
  topP,
  toolChoice,
  toolSchemaOptions = {},
  responseFormat,
  userId,
  cacheUserId,
  reasoningReplay,
} = {}) {
  const config = resolveDeepSeekConfig({
    env,
    cwd,
    overrides: {
      reasoningReplay,
      model,
      thinking,
      reasoningEffort,
      cacheUserId: userId ?? cacheUserId,
    },
  })
  // Which tools use /beta strict function-calling. Default mode comes from the
  // DEEPCODE_STRICT_TOOLS harness config (off|safe|all|nullable); an explicit boolean
  // strictTools is honored for back-compat (true=all, false=off). 'off' (the
  // default when unset) yields an empty set → no per-tool strict and the base
  // URL is unchanged, so the common path stays byte-identical.
  const strictMode = resolveStrictMode({ strictTools, env })
  const strictToolNames = resolveStrictToolNames(strictMode, tools)
  const baseUrl =
    strictToolNames.size > 0
      ? ensureBetaBaseUrl(config.baseUrl)
      : config.baseUrl
  const thinkingEnabled = config.thinking !== 'disabled'

  const body = omitUndefined({
    model: config.model,
    messages: [
      ...systemPromptToMessages(systemPrompt),
      ...mapMessagesToDeepSeek(messages, {
        reasoningReplay: config.reasoningReplay,
      }),
    ],
    tools:
      tools.length > 0
        ? await Promise.all(
            [...tools]
              // byteCompare (NOT localeCompare): this manifest rides the DeepSeek cached
              // prefix, so its order must be locale-independent (see cache/byte-order.mjs).
              .sort((a, b) => byteCompare(a.name, b.name))
              .map(tool =>
                cachedToolToDeepSeekFunctionSchema(tool, {
                  ...toolSchemaOptions,
                  // Pass the MODE (off|safe|all|nullable) for a selected tool so the
                  // renderer picks strict vs nullable; undefined when unselected. A
                  // bare boolean here could not distinguish 'all' from 'nullable'.
                  strict: strictToolNames.has(tool.name ?? tool.function?.name)
                    ? strictMode
                    : undefined,
                  tools: toolSchemaOptions.tools ?? tools,
                }),
              ),
          )
        : undefined,
    tool_choice: toolChoice,
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    reasoning_effort: thinkingEnabled ? config.reasoningEffort : undefined,
    max_tokens: maxTokens,
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
    response_format: responseFormat,
    user_id: config.cacheUserId,
    temperature: thinkingEnabled ? undefined : temperature,
    top_p: thinkingEnabled ? undefined : topP,
  })

  return {
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers: omitUndefined({
      'Content-Type': 'application/json',
      Authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined,
    }),
    body,
  }
}

export async function buildDeepSeekRouterRequest({
  systemPrompt = [],
  userPrompt = '',
  messages,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const routerMessages = Array.isArray(messages)
    ? messages
    : [{ role: 'user', content: userPrompt }]

  return await buildDeepSeekRequest({
    systemPrompt,
    messages: routerMessages,
    env,
    cwd,
    model: DEFAULT_DEEPSEEK_SMALL_MODEL,
    stream: false,
    thinking: 'disabled',
    temperature: 0,
    maxTokens: 80,
    responseFormat: { type: 'json_object' },
  })
}

export async function runDeepSeekAgent({
  prompt,
  messages = [],
  systemPrompt = [],
  tools = [],
  env = process.env,
  cwd = process.cwd(),
  provider,
  complete,
  maxTurns = 8,
  // undefined => buildDeepSeekRequest resolves the mode from DEEPCODE_STRICT_TOOLS.
  strictTools,
} = {}) {
  const modelProvider = provider ?? createDeepSeekProvider()
  if (complete !== undefined && typeof complete !== 'function') {
    throw new TypeError('runDeepSeekAgent complete must be a function when provided')
  }

  const conversation = [...messages]
  if (prompt) {
    conversation.push({ role: 'user', content: prompt })
  }
  const executableTools = new Map(tools.map(tool => [tool.name, tool]))
  let lastResponse = null

  for (let turn = 0; turn < maxTurns; turn++) {
    // Build via the provider so a non-DeepSeek provider produces its own request
    // format. For the DeepSeek provider this is buildDeepSeekRequest with an
    // empty defaults spread — byte-identical to the prior direct call.
    const request = await modelProvider.buildRequest({
      systemPrompt,
      messages: conversation,
      tools,
      env,
      cwd,
      strictTools,
    })
    const response =
      typeof complete === 'function'
        ? await complete(request)
        : await collectDeepSeekStreamEvents(modelProvider.streamQuery(request))
    lastResponse = response
    const toolCalls = normalizeToolCalls(response.toolCalls)

    if (toolCalls.length === 0) {
      return {
        content: response.content ?? '',
        reasoning: response.reasoning ?? '',
        usage: response.usage,
        messages: conversation,
      }
    }

    conversation.push({
      role: 'assistant',
      content: response.content ?? '',
      reasoning_content: response.reasoning ?? '',
      tool_calls: toolCalls,
    })

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name
      const tool = executableTools.get(toolName)
      let content
      try {
        const toolInput = parseToolArguments(toolCall.function.arguments)
        let result
        if (!tool) {
          result = `Tool ${toolName} is not available.`
        } else if (typeof tool.execute === 'function') {
          result = await tool.execute(toolInput, { cwd, env, toolCall })
        } else if (typeof tool.call === 'function') {
          result = await tool.call(toolInput)
        } else {
          result = `Tool ${toolName} has no executable handler.`
        }
        // Inside the try so a circular/unserializable tool return that breaks
        // stringify is also fed back as an error rather than aborting the turn.
        content = stringifyToolResultContent(result)
      } catch (error) {
        // A real cancellation (Ctrl-C, or ACP session/cancel — the wrapped ACP
        // tool throws an AbortError when its signal is aborted) must END the
        // turn, so re-throw it. Every OTHER tool failure is DATA for the model:
        // a thrown Edit old_string-not-found, Read ENOENT, a denied write, or a
        // wrong-shape argument is surfaced as THIS tool_call's result so the
        // loop can self-correct, matching the OpenAI/Claude tool-failure-is-a-
        // tool-result contract. Without this the throw unwinds out of the loop
        // and aborts the whole turn (native single-turn exits 1; the ACP turn
        // returns JSON-RPC -32603) and the model never sees the error.
        if (isAbortError(error)) throw error
        content = `Error: ${String(error?.message ?? error)}`
      }
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content,
      })
    }
  }

  return {
    content: lastResponse?.content ?? '',
    reasoning: lastResponse?.reasoning ?? '',
    usage: lastResponse?.usage,
    messages: conversation,
    stoppedReason: 'max_turns',
  }
}

export function createDeepSeekProvider(defaults = {}) {
  const capabilities = new Set(DEEPSEEK_PROVIDER_CAPABILITIES)

  return assertModelProvider({
    name: 'deepseek',

    streamQuery(context = {}) {
      return streamDeepSeekQuery({ ...defaults, ...context })
    },

    async buildRequest(context = {}) {
      return await buildDeepSeekRequest({ ...defaults, ...context })
    },

    parseStreamChunk(chunk) {
      return parseDeepSeekStreamChunk(chunk)
    },

    mapUsage(usage) {
      return mapDeepSeekUsage(usage)
    },

    supports(capability) {
      return capabilities.has(capability)
    },
  })
}

export async function* streamDeepSeekQuery(context = {}) {
  // `let` so an _or_flash retry can swap in a resource-reduced body. The reassign
  // spreads into a NEW object, so when `request === context` the caller's context
  // is never mutated.
  let request =
    context.url && context.method && context.headers && context.body
      ? context
      : await buildDeepSeekRequest(context)
  const fetchFn = context.fetch ?? globalThis.fetch
  const sleep = context.sleep ?? sleepMs
  const maxRetries = context.maxRetries ?? 2
  const requestTimeoutMs = resolveRequestTimeoutMs(context)
  let response

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeoutMs)
    timer.unref?.()
    const detachUserSignal = forwardAbortToController(context.signal, controller)

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
      clearTimeout(timer)
      detachUserSignal()
      if (timedOut) {
        if (attempt === maxRetries) {
          throw createDeepSeekTimeoutError(request.url, requestTimeoutMs)
        }
        await abortableDelay(
          calculateDeepSeekRetryDelayMs({}, attempt, context),
          context.signal,
          sleep,
        )
        continue
      }
      throw error
    }

    if (response.ok) {
      clearTimeout(timer)
      try {
        yield* streamDeepSeekResponseBody(response.body)
      } finally {
        detachUserSignal()
      }
      return
    }

    let text
    try {
      text = await response.text()
    } catch (error) {
      clearTimeout(timer)
      detachUserSignal()
      if (timedOut) {
        if (attempt === maxRetries) {
          throw createDeepSeekTimeoutError(request.url, requestTimeoutMs)
        }
        await abortableDelay(
          calculateDeepSeekRetryDelayMs({}, attempt, context),
          context.signal,
          sleep,
        )
        continue
      }
      throw error
    }
    clearTimeout(timer)
    detachUserSignal()

    const recovery = mapDeepSeekHttpError({
      status: response.status,
      headers: response.headers,
      message: text,
    })
    if (!recovery.retryable || attempt === maxRetries) {
      throw createDeepSeekApiError(response.status, text, recovery)
    }

    // Wire the recovery strategy: when it authorizes flash fallback (503 /
    // insufficient resource), don't blindly re-send the body the server just
    // rejected for capacity — route the retry to the small model and lower the
    // reasoning effort one tier so the next attempt actually demands less.
    if (isFlashDowngradeStrategy(recovery.retryStrategy)) {
      const { body, changed } = downgradeDeepSeekRetryBody(request.body, {
        smallModel: context.smallModel ?? DEFAULT_DEEPSEEK_SMALL_MODEL,
      })
      if (changed) request = { ...request, body }
    }

    await abortableDelay(
      calculateDeepSeekRetryDelayMs(recovery, attempt, context),
      context.signal,
      sleep,
    )
  }

  throw new Error(`DeepSeek API exhausted retries`)
}

function resolveRequestTimeoutMs(context) {
  if (Number.isFinite(context.requestTimeoutMs) && context.requestTimeoutMs > 0) {
    return context.requestTimeoutMs
  }
  const raw =
    context.env?.DEEPCODE_REQUEST_TIMEOUT_MS ??
    process.env.DEEPCODE_REQUEST_TIMEOUT_MS
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 300_000
}

function forwardAbortToController(userSignal, controller) {
  if (!userSignal) return () => {}
  if (userSignal.aborted) {
    controller.abort(userSignal.reason)
    return () => {}
  }
  const handler = () => controller.abort(userSignal.reason)
  userSignal.addEventListener('abort', handler, { once: true })
  return () => userSignal.removeEventListener('abort', handler)
}

function createDeepSeekTimeoutError(url, timeoutMs) {
  const error = new Error(
    `DeepSeek API request timed out after ${timeoutMs}ms (no response from ${url}). ` +
      `Override with DEEPCODE_REQUEST_TIMEOUT_MS.`,
  )
  error.code = 'DEEPCODE_REQUEST_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

export function calculateDeepSeekRetryDelayMs(
  recovery,
  attempt,
  {
    retryBaseDelayMs = 500,
    retryMaxDelayMs = 8000,
    retryAfterMaxMs = 60000,
    random = Math.random,
  } = {},
) {
  // An explicit Retry-After is authoritative (no jitter — the server told us exactly when
  // to retry), and a sane value is honored VERBATIM: clamping a server-requested 30s down
  // to our 8s backoff ceiling would make us retry 22s early and re-collide on the very
  // 429 it was pacing us off of. It is bounded only against a misconfigured/hostile
  // upstream sending an absurd `Retry-After: 86400` (a day-long freeze) — by a SEPARATE,
  // larger ceiling (retryAfterMaxMs, default 60s) distinct from the exponential backoff
  // cap — and floored at 0 so a negative value can't yield a negative sleep.
  if (recovery.retryAfterSeconds !== undefined) {
    return Math.min(retryAfterMaxMs, Math.max(0, recovery.retryAfterSeconds * 1000))
  }
  // Exponential backoff with equal jitter (delay in [ceiling/2, ceiling]). Without
  // jitter, concurrent requests that share one schedule (parallel subagents / a Task
  // fan-out) retry in lockstep and re-collide on the same 429/503 boundary every round,
  // amplifying the overload (thundering herd). Equal jitter decorrelates the retries
  // while keeping a sane minimum backoff, and still decorrelates once the delay is
  // capped at retryMaxDelayMs. `random` is injectable so tests can pin exact bounds; it is
  // coerced to its documented [0, 1) domain (a misbehaving injected rng — negative, NaN,
  // or >= 1 — can never produce a negative or over-cap sleep), so the bound is unconditional.
  const ceiling = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** attempt)
  const half = ceiling / 2
  const raw = random()
  const r = raw >= 0 ? Math.min(1, raw) : 0
  return Math.round(half + r * half)
}

export async function* streamDeepSeekResponseBody(body) {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const event of parseDeepSeekSSELines(lines)) {
      yield event
    }
  }

  if (buffer.trim()) {
    for (const event of parseDeepSeekSSELines([buffer])) {
      yield event
    }
  }
}

export async function collectDeepSeekStreamEvents(events, { onContent } = {}) {
  let content = ''
  let reasoning = ''
  let usage = null
  let finishReason = null
  const toolCalls = new Map()

  for await (const event of events) {
    if (event.type === 'reasoning_delta') {
      reasoning += event.text
    } else if (event.type === 'content_delta') {
      content += event.text
      onContent?.(event.text)
    } else if (event.type === 'error') {
      // A mid-stream server error must fail the collection (runDeepSeekAgent
      // non-streaming, /compact, doctor, cache warmup), not return the partial
      // content as a complete response.
      throw createDeepSeekStreamError(event.error)
    } else if (event.type === 'tool_call_delta') {
      mergeDeepSeekToolCallDelta(toolCalls, event)
      if (event.finishReason) finishReason = event.finishReason
    } else if (event.type === 'finish') {
      finishReason = event.finishReason
    } else if (event.type === 'usage') {
      usage = event.usage
    }
  }

  return {
    content,
    reasoning,
    usage,
    finishReason,
    toolCalls: [...toolCalls.values()],
  }
}

export function mergeDeepSeekToolCallDelta(toolCalls, event, makeId = randomUUID) {
  const index = resolveToolCallIndex(toolCalls, event)
  const existing =
    toolCalls.get(index) ??
    {
      // Synthesize a stable fallback id when the gateway omits one, mirroring the
      // main streaming path (deepseek-call-model.mjs). A tool call with id:undefined
      // wedges the multi-turn loop — the tool_result can't correlate back to the
      // call and DeepSeek rejects the next request with a 400. The id only needs to
      // be unique within the turn; once set it is fixed in the assembled message
      // (so the conformant path, where event.id is present, stays byte-identical).
      id: event.id ?? `toolu_deepseek_${makeId()}`,
      type: 'function',
      function: { name: event.name, arguments: '' },
    }
  if (event.id) existing.id = event.id
  if (event.name) existing.function.name = event.name
  if (event.argumentsDelta) existing.function.arguments += event.argumentsDelta
  toolCalls.set(index, existing)
  return existing
}

export function parseDeepSeekStreamChunk(chunk) {
  const text =
    typeof chunk === 'string'
      ? chunk
      : new TextDecoder().decode(chunk, { stream: false })
  return parseDeepSeekSSELines(text.split(/\r?\n/))
}

export function parseDeepSeekSSELines(lines) {
  const events = []
  for (const line of lines) {
    const trimmed = String(line).trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue

    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      events.push({ type: 'done' })
      continue
    }

    // ROBUSTNESS: a single malformed / truncated `data:` line (network glitch,
    // proxy interference, or a connection dropped mid-message so the
    // final-buffer flush sees partial JSON) must NOT abort the whole stream —
    // skip it and keep parsing the rest. Previously an unguarded JSON.parse
    // threw, crashing streamDeepSeekResponseBody and losing all already-received
    // content.
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    // A JSON-VALID but non-object chunk (`data: null`, `data: 5`, `data: "x"` from a
    // misbehaving proxy) passes JSON.parse but would throw on chunk.choices/usage/error
    // below (`Cannot read properties of null`) — same skip-the-bad-line invariant as
    // the parse guard. (An array chunk is harmless: chunk.choices is just undefined.)
    if (!chunk || typeof chunk !== 'object') continue
    // Same invariant as the JSON.parse guard above: one structurally-valid chunk
    // carrying a null/garbage `choices` or `tool_calls` ELEMENT (padding some
    // non-conformant OpenAI-compatible gateways emit) must NOT abort the stream and
    // lose already-yielded content. Coerce to arrays (a non-array isn't iterable) and
    // skip non-object entries, rather than throwing on `choice.delta`/`toolCall.index`.
    const choices = Array.isArray(chunk.choices) ? chunk.choices : []
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue
      const delta = choice.delta ?? {}
      if (delta.reasoning_content) {
        events.push({ type: 'reasoning_delta', text: delta.reasoning_content })
      }
      if (delta.content) {
        events.push({ type: 'content_delta', text: delta.content })
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
      for (const toolCall of toolCalls) {
        if (!toolCall || typeof toolCall !== 'object') continue
        const event = omitUndefined({
          type: 'tool_call_delta',
          index: toolCall.index,
          id: toolCall.id,
          name: toolCall.function?.name,
          argumentsDelta: toolCall.function?.arguments,
          finishReason: choice.finish_reason ?? undefined,
        })
        events.push(event)
      }
      // Emit a synthetic finish whenever a choice carries finish_reason and is NOT
      // a tool-call chunk (tool_call_delta already carries finishReason, so a
      // separate finish would be redundant). This MUST fire even when the SAME
      // chunk also carries content/reasoning: many OpenAI-compatible servers
      // attach finish_reason to the LAST content chunk, whereas DeepSeek uses a
      // trailing empty-delta chunk (so DeepSeek is unaffected — it never bundles).
      // Without this, a pure-text turn from such a server ended with
      // stop_reason:null. The finish is pushed AFTER the content_delta above, so
      // consumers see content first, then finish (the agent loop only records
      // finishReason on finish; blocks close after the stream drains).
      const hasToolCallDeltas = toolCalls.length > 0
      if (choice.finish_reason && !hasToolCallDeltas) {
        events.push({ type: 'finish', finishReason: choice.finish_reason })
      }
    }
    if (chunk.usage) {
      events.push({ type: 'usage', usage: mapDeepSeekUsage(chunk.usage) })
    }
    // A mid-stream top-level `{"error": {...}}` chunk (the OpenAI/DeepSeek
    // shape for a fault that occurs AFTER the 200 response has begun) carries
    // neither `choices` nor `usage`, so it matched no branch above and was
    // silently dropped — the turn then committed whatever partial text had
    // already streamed as a SUCCESS (no error, no retry). Surface it as an
    // `error` event (emitted AFTER any same-chunk content) so consumers fail
    // the turn loudly. The happy path is untouched (this only fires when
    // `chunk.error` is present).
    if (chunk.error) {
      events.push({ type: 'error', error: chunk.error })
    }
  }
  return events
}

/**
 * Build a loud, non-abort Error from a mid-stream DeepSeek `error` event so the
 * turn unwinds instead of committing a truncated response as success. The
 * server's `code`/`type` are stored under `deepSeekCode`/`deepSeekType` — NOT
 * `code`/`name` — so a server code of `ABORT_ERR` can never make isAbortError
 * misclassify this as a cancellation.
 */
export function createDeepSeekStreamError(error) {
  const message =
    (error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : '') || 'unknown error'
  const err = new Error(`DeepSeek stream error: ${message}`)
  err.name = 'DeepSeekStreamError'
  err.deepSeekStreamError = true
  if (error && typeof error === 'object') {
    if (error.type !== undefined) err.deepSeekType = error.type
    if (error.code !== undefined) err.deepSeekCode = error.code
  }
  return err
}

export function mapDeepSeekUsage(usage = {}) {
  return {
    ...(usage.prompt_cache_hit_tokens !== undefined && {
      prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
    }),
    ...(usage.prompt_cache_miss_tokens !== undefined && {
      prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens,
    }),
    ...(usage.prompt_tokens !== undefined && {
      prompt_tokens: usage.prompt_tokens,
    }),
    ...(usage.completion_tokens !== undefined && {
      completion_tokens: usage.completion_tokens,
    }),
    ...(usage.total_tokens !== undefined && {
      total_tokens: usage.total_tokens,
    }),
    ...(usage.completion_tokens_details?.reasoning_tokens !== undefined && {
      reasoning_tokens: usage.completion_tokens_details.reasoning_tokens,
    }),
  }
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) return {}
  if (typeof rawArguments !== 'string') return rawArguments
  try {
    return JSON.parse(rawArguments)
  } catch {
    return { _raw: rawArguments }
  }
}

// True for a cancellation, not a tool failure. Covers both abort shapes used in
// this stack: fetch()/AbortSignal reject with a DOMException whose name is
// 'AbortError' (code 'ABORT_ERR'), and the ACP tool wrapper throws an Error
// hand-tagged `name: 'AbortError'`. A cancelled turn must unwind; a tool error
// must be fed back to the model — so the agent loop branches on this.
function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

function systemPromptToMessages(systemPrompt) {
  if (Array.isArray(systemPrompt)) {
    const content = systemPrompt.filter(Boolean).join('\n\n')
    return content ? [{ role: 'system', content }] : []
  }
  return systemPrompt ? [{ role: 'system', content: String(systemPrompt) }] : []
}

function normalizeDeepSeekEffort(value) {
  // Pass the server's graded enum through (low/medium/high/max/xhigh); an unset
  // effort still resolves to 'max' so the default request prefix is byte-identical.
  return coerceDeepSeekEffort(value, { unset: 'max', fallback: 'high' })
}

function ensureBetaBaseUrl(baseUrl) {
  return baseUrl.endsWith('/beta') ? baseUrl : `${baseUrl}/beta`
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '')
}

// Cancellable backoff sleep. On abort it CLEARS the timer (rather than unref'ing
// it — unref could let a one-shot/print-mode run exit mid-retry and silently
// drop a legitimate backoff) and rejects with the abort reason, so a cancelled
// query both unwinds promptly and stops pinning the event loop for the full
// wait. `timers` is injectable for tests.
export function sleepMs(ms, signal, timers = {}) {
  const setTimer = timers.setTimer ?? setTimeout
  const clearTimer = timers.clearTimer ?? clearTimeout
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    const timer = setTimer(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimer(timer)
      reject(abortReason(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// An actionable next step for the recognizable, common DeepSeek failures so the
// user sees what to DO instead of only a raw provider JSON body. '' for statuses
// with no specific guidance (the raw status + body still shows either way).
export function deepSeekApiErrorHint(status) {
  switch (status) {
    case 401:
      return 'Authentication failed — check your DeepSeek API key (run /login, or set DEEPSEEK_API_KEY).'
    case 402:
      return 'Insufficient balance — top up your DeepSeek account at https://platform.deepseek.com.'
    default:
      return ''
  }
}

function createDeepSeekApiError(status, message, recovery) {
  const hint = deepSeekApiErrorHint(status)
  const error = new Error(
    `DeepSeek API ${status}: ${message}${hint ? `\n${hint}` : ''}`,
  )
  error.status = status
  error.recovery = recovery
  return error
}
