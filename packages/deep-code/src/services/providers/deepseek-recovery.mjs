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
