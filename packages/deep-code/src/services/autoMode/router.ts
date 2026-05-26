export type AutoRouteModel = 'flash' | 'pro'
export type AutoRouteThinking = 'off' | 'high' | 'max'
export type AutoRouteDecision = {
  model: AutoRouteModel
  thinking: AutoRouteThinking
  source: 'router' | 'heuristic'
  reason?: string
}

export const ROUTER_SYSTEM = `You are a router. Given the user's latest message
and a short context summary, output JSON: {"model":"flash"|"pro","thinking":"off"|"high"|"max"}.
Use flash+off for short questions, pro+max for ambiguous multi-step coding tasks.
No prose, only JSON.`

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
  const text = latestUserMessage.trim()
  const lower = text.toLowerCase()

  if (/\b(architecture|architectural|design|proof|prove|deep|careful|carefully|reason|reasoning)\b/.test(lower)) {
    return heuristic('pro', 'max', 'deep_reasoning_requested')
  }

  if (/\b(quick|quickly|fast|brief|briefly|short|speed)\b/.test(lower)) {
    return heuristic('flash', 'off', 'speed_requested')
  }

  if (/\b(refactor|debug|debugging|tests?|test repair|multi[-\s]?file|several files|multiple files|across files|integration)\b/.test(lower)) {
    return heuristic('pro', 'max', 'complex_change')
  }

  if (/\b(edit|modify|change|update|fix)\b/.test(lower) && hasFilePath(text)) {
    return heuristic('pro', 'high', 'single_file_edit')
  }

  if (text.length < 300 && /\b(what|who|when|where|why|how|explain|summarize|list|show)\b/.test(lower)) {
    return heuristic('flash', 'off', 'short_factual')
  }

  if (/\b(read|inspect|explain|summarize|describe|list|show)\b/.test(lower)) {
    return heuristic('flash', 'off', 'read_only_simple')
  }

  return heuristic('pro', 'high', 'general_task')
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

function hasFilePath(text: string): boolean {
  return /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|cpp|c|h|hpp|css|scss|html|ya?ml)\b/i.test(text)
}

function isAutoRouteModel(value: unknown): value is AutoRouteModel {
  return value === 'flash' || value === 'pro'
}

function isAutoRouteThinking(value: unknown): value is AutoRouteThinking {
  return value === 'off' || value === 'high' || value === 'max'
}

function heuristic(
  model: AutoRouteModel,
  thinking: AutoRouteThinking,
  reason: string,
): AutoRouteDecision {
  return { model, thinking, source: 'heuristic', reason }
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
