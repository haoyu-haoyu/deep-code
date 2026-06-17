import { classifyRouteHeuristic } from './classifyRouteHeuristic.mjs'

export type AutoRouteModel = 'flash' | 'pro'
// Full DeepSeek effort ladder (off = thinking disabled). reasoning_effort is not
// in DeepSeek's cache key (probe-confirmed), so per-task variation is cache-safe.
export type AutoRouteThinking =
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'max'
  | 'xhigh'
export type AutoRouteDecision = {
  model: AutoRouteModel
  thinking: AutoRouteThinking
  source: 'router' | 'heuristic'
  reason?: string
}

export const ROUTER_SYSTEM = `You are a routing classifier for a coding agent. Given the user's latest message and a short context summary, choose a model and reasoning effort, then output ONLY JSON: {"model":"flash"|"pro","thinking":"off"|"low"|"medium"|"high"|"max"|"xhigh"}.

Match effort to the TASK's difficulty (your choice holds for the whole task):
- flash+off: trivial lookups, one-line factual answers, explicit speed requests.
- flash+low or pro+low: read-only questions, listing, summarizing, classification — even if they mention tests/debug/refactor as a topic.
- pro+medium or pro+high: single-file edits and moderate changes.
- pro+max: complex multi-file changes, refactors, debugging a real failure.
- pro+xhigh: the genuinely hardest reasoning — architecture/algorithm design, concurrency/distributed correctness, formal proofs.

Distinguish a question ABOUT something (read-only, cheaper) from a request to DO something (action, more effort). When unsure, prefer the HIGHER effort — under-reasoning a hard task is worse than over-spending on an easy one. No prose, only JSON.`

const ROUTER_TIMEOUT_MS = 5_000
const ROUTER_MAX_CHARS = 1_200
const ROUTER_MAX_TOKENS = 80

export async function routeTurn(
  messages: readonly unknown[],
  signal: AbortSignal,
): Promise<AutoRouteDecision> {
  const latestUserMessage = extractLatestUserMessage(messages)
  const fallback = () => fallbackHeuristic(latestUserMessage)

  if (signal.aborted || typeof globalThis.fetch !== 'function') {
    return fallback()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT_MS)
  timeout.unref?.()
  const detachAbort = forwardAbort(signal, controller)

  try {
    const { buildDeepSeekRequest, DEFAULT_DEEPSEEK_SMALL_MODEL } = await import(
      '../providers/deepseek.mjs'
    )
    const request = await buildDeepSeekRequest({
      systemPrompt: [ROUTER_SYSTEM],
      messages: [
        {
          role: 'user',
          content: buildRouterUserPrompt(messages, latestUserMessage),
        },
      ],
      model: DEFAULT_DEEPSEEK_SMALL_MODEL,
      stream: false,
      thinking: 'disabled',
      temperature: 0,
      maxTokens: ROUTER_MAX_TOKENS,
      responseFormat: { type: 'json_object' },
    })
    const response = await globalThis.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      body: JSON.stringify(request.body),
    })

    if (!response.ok) return fallback()

    const payload = await response.json()
    return parseRouterDecision(extractRouterContent(payload))
  } catch {
    return fallback()
  } finally {
    clearTimeout(timeout)
    detachAbort()
  }
}

export function fallbackHeuristic(latestUserMessage: string): AutoRouteDecision {
  // Pure classification lives in the .mjs leaf (node-unit-tested); this thin
  // wrapper just stamps the heuristic source.
  return { ...classifyRouteHeuristic(latestUserMessage), source: 'heuristic' }
}

function parseRouterDecision(content: string): AutoRouteDecision {
  const parsed = JSON.parse(extractJsonObject(content))
  if (!isAutoRouteModel(parsed?.model) || !isAutoRouteThinking(parsed?.thinking)) {
    throw new Error('router returned invalid auto route values')
  }
  return {
    model: parsed.model,
    thinking: parsed.thinking,
    source: 'router',
  }
}

function extractRouterContent(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') {
    throw new Error('router response is not an object')
  }
  const choices = (payload as { choices?: unknown }).choices
  if (Array.isArray(choices)) {
    const first = choices[0]
    if (first && typeof first === 'object') {
      const message = (first as { message?: unknown }).message
      if (message && typeof message === 'object') {
        const content = (message as { content?: unknown }).content
        if (typeof content === 'string') return content
      }
    }
  }
  const content = (payload as { content?: unknown }).content
  if (typeof content === 'string') return content
  throw new Error('router response did not contain message content')
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function buildRouterUserPrompt(
  messages: readonly unknown[],
  latestUserMessage: string,
): string {
  const compactMessage = truncate(latestUserMessage, ROUTER_MAX_CHARS)
  return [
    `Message count: ${messages.length}`,
    `Latest user message:`,
    compactMessage,
  ].join('\n')
}

function extractLatestUserMessage(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i]
    if (!candidate || typeof candidate !== 'object') continue
    const role = (candidate as { role?: unknown }).role
    if (role !== 'user') continue
    const content = (candidate as { content?: unknown }).content
    const text = contentToText(content)
    if (text.trim()) return text
  }
  return ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown }).text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function isAutoRouteModel(value: unknown): value is AutoRouteModel {
  return value === 'flash' || value === 'pro'
}

function isAutoRouteThinking(value: unknown): value is AutoRouteThinking {
  return (
    value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'max' ||
    value === 'xhigh'
  )
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`
}

function forwardAbort(signal: AbortSignal, controller: AbortController): () => void {
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}
