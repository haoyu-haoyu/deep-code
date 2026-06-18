import { DEEPSEEK_REASONING_EFFORTS } from './deepseekEffort.mjs'

export const DEEPSEEK_FINISH_ACTIONS = Object.freeze({
  STOP: 'stop',
  RUN_TOOLS: 'run_tools',
  COMPACT_OR_RESUME: 'compact_or_resume',
  CONTENT_FILTER: 'content_filter',
  DOWNGRADE_OR_RETRY: 'downgrade_or_retry',
  UNKNOWN: 'unknown',
})

export function mapDeepSeekFinishReason(finishReason) {
  switch (finishReason) {
    case 'stop':
      return {
        finishReason,
        action: DEEPSEEK_FINISH_ACTIONS.STOP,
        retryable: false,
      }
    case 'tool_calls':
      return {
        finishReason,
        action: DEEPSEEK_FINISH_ACTIONS.RUN_TOOLS,
        retryable: false,
      }
    case 'length':
      return {
        finishReason,
        action: DEEPSEEK_FINISH_ACTIONS.COMPACT_OR_RESUME,
        retryable: true,
      }
    case 'content_filter':
      return {
        finishReason,
        action: DEEPSEEK_FINISH_ACTIONS.CONTENT_FILTER,
        retryable: false,
      }
    case 'insufficient_system_resource':
      return {
        finishReason,
        action: DEEPSEEK_FINISH_ACTIONS.DOWNGRADE_OR_RETRY,
        retryable: true,
        retryStrategy: 'lower_reasoning_effort_or_use_flash',
      }
    default:
      return {
        finishReason: finishReason ?? 'unknown',
        action: DEEPSEEK_FINISH_ACTIONS.UNKNOWN,
        retryable: false,
      }
  }
}

// Transient gateway / timeout statuses that a CDN or reverse-proxy in front of the API
// returns routinely on a long-running CLI agent — retry with backoff rather than abort
// the turn on the first hit. Deliberately an EXPLICIT set, NOT a blanket `status >= 500`:
// 501 (Not Implemented) and 505 (HTTP Version Not Supported) are not transient and must
// fail fast. 429/503 keep their own dedicated branches above (distinct retryStrategy).
const TRANSIENT_HTTP_STATUSES = new Set([408, 500, 502, 504])

export function mapDeepSeekHttpError({
  status,
  code,
  message = '',
  headers = {},
} = {}) {
  const retryAfterSeconds = parseRetryAfter(headers)
  if (status === 429) {
    return {
      status,
      code,
      message,
      retryable: true,
      retryAfterSeconds,
      retryStrategy: 'exponential_backoff',
    }
  }

  if (status === 503) {
    return {
      status,
      code,
      message,
      retryable: true,
      retryAfterSeconds,
      retryStrategy: 'exponential_backoff_or_flash',
    }
  }

  if (TRANSIENT_HTTP_STATUSES.has(status)) {
    return {
      status,
      code,
      message,
      retryable: true,
      retryAfterSeconds,
      retryStrategy: 'exponential_backoff',
    }
  }

  return {
    status,
    code,
    message,
    retryable: false,
    retryAfterSeconds,
    retryStrategy: 'none',
  }
}

// Retry strategies (from mapDeepSeekHttpError / mapDeepSeekFinishReason) that
// authorize falling back to the small/flash model + a lighter reasoning effort
// on retry, instead of blindly re-sending the same request the server just
// rejected for capacity/resource reasons (503, insufficient_system_resource).
const FLASH_DOWNGRADE_STRATEGIES = new Set([
  // 503 (mapDeepSeekHttpError) — reached by streamDeepSeekQuery's HTTP retry loop.
  'exponential_backoff_or_flash',
  // insufficient_system_resource finish (mapDeepSeekFinishReason) — consumed on the
  // call-model path, not this loop; listed here so the shared downgrade leaf covers
  // it too (the flash+lower-effort downgrade is a correct superset of what it asks).
  'lower_reasoning_effort_or_use_flash',
])

/**
 * @param {unknown} retryStrategy
 * @returns {boolean}
 */
export function isFlashDowngradeStrategy(retryStrategy) {
  return FLASH_DOWNGRADE_STRATEGIES.has(retryStrategy)
}

/**
 * Step a reasoning_effort one tier toward 'low'. Absent / unknown / already-'low'
 * (or thinking-disabled 'off') is returned unchanged.
 * @param {unknown} effort
 * @returns {unknown}
 */
export function lowerDeepSeekEffort(effort) {
  const i = DEEPSEEK_REASONING_EFFORTS.indexOf(String(effort ?? '').toLowerCase())
  return i > 0 ? DEEPSEEK_REASONING_EFFORTS[i - 1] : effort
}

/**
 * Build a resource-reduced retry body for an _or_flash strategy: route to the
 * small/flash model and lower reasoning_effort one tier. Returns { body, changed };
 * `changed` is false (and `body` returned unchanged) when nothing could be
 * downgraded — so the caller skips a pointless re-serialization. Accepts a JSON
 * string or an object body and returns the same shape.
 * @param {string|object} body
 * @param {{ smallModel?: string }} [opts]
 * @returns {{ body: string|object, changed: boolean }}
 */
export function downgradeDeepSeekRetryBody(body, { smallModel } = {}) {
  const isString = typeof body === 'string'
  let obj
  if (isString) {
    try {
      obj = JSON.parse(body)
    } catch {
      return { body, changed: false }
    }
  } else {
    obj = body
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { body, changed: false }
  }
  const next = { ...obj }
  let changed = false
  if (smallModel && next.model !== smallModel) {
    next.model = smallModel
    changed = true
  }
  if (next.reasoning_effort != null) {
    const lowered = lowerDeepSeekEffort(next.reasoning_effort)
    if (lowered !== next.reasoning_effort) {
      next.reasoning_effort = lowered
      changed = true
    }
  }
  if (!changed) return { body, changed: false }
  return { body: isString ? JSON.stringify(next) : next, changed: true }
}

function parseRetryAfter(headers = {}) {
  const value =
    typeof headers.get === 'function'
      ? headers.get('retry-after')
      : headers['retry-after'] ?? headers['Retry-After']
  if (!value) return undefined

  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric

  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000))
}
