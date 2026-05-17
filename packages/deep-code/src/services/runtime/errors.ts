import type { SDKAssistantMessageError } from '../../entrypoints/agentSdkTypes.js'

export type { SDKAssistantMessageError }

export class RuntimeRequestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'RuntimeRequestError'
  }
}

export class RuntimeAbortError extends Error {
  constructor(message = 'Runtime request aborted') {
    super(message)
    this.name = 'RuntimeAbortError'
  }
}

export function isRuntimeAbortError(
  err: unknown,
): err is RuntimeAbortError {
  return err instanceof RuntimeAbortError
}

export function isRuntimeRequestError(
  err: unknown,
): err is RuntimeRequestError {
  return err instanceof RuntimeRequestError
}

export function formatRuntimeErrorForUser(err: unknown): string {
  if (isRuntimeAbortError(err)) {
    return err.message
  }
  if (isRuntimeRequestError(err)) {
    return err.status
      ? `Runtime API error (${err.status}): ${err.message}`
      : `Runtime API error: ${err.message}`
  }
  if (err instanceof Error && err.message) {
    return `Runtime error: ${err.message}`
  }
  return 'Runtime error: request failed'
}

export function toRuntimeError(
  err: unknown,
): RuntimeRequestError | RuntimeAbortError {
  if (isRuntimeRequestError(err)) return err
  if (isRuntimeAbortError(err)) return err
  if (isAbortLikeError(err)) {
    return new RuntimeAbortError()
  }
  const status = readStatus(err)
  const message =
    err instanceof Error && err.message ? err.message : 'request failed'
  return new RuntimeRequestError(message, err, status)
}

function isAbortLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const record = err as { name?: unknown; code?: unknown }
  return record.name === 'AbortError' || record.code === 'ABORT_ERR'
}

function readStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status)
    ? status
    : undefined
}

export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export function isPromptTooLongMessage(
  msg:
    | {
        type?: string
        isApiErrorMessage?: boolean
        message?: { content?: ReadonlyArray<{ type?: string; text?: string }> }
      }
    | null
    | undefined,
): boolean {
  if (!msg || msg.type !== 'assistant' || !msg.isApiErrorMessage) return false
  return (
    msg.message?.content?.some(
      block =>
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
    ) ?? false
  )
}

export function categorizeRetryableAPIError(
  error: { status?: number; message?: string } | null | undefined,
): SDKAssistantMessageError {
  if (!error) return 'unknown'
  if (
    error.status === 529 ||
    error.message?.includes('"type":"overloaded_error"')
  ) {
    return 'rate_limit'
  }
  if (error.status === 429) return 'rate_limit'
  if (error.status === 401 || error.status === 403) {
    return 'authentication_failed'
  }
  if (error.status !== undefined && error.status >= 408) {
    return 'server_error'
  }
  return 'unknown'
}

// API_ERROR_MESSAGE_PREFIX mirrors the literal emitted by assistant API-error
// messages so runtime callers can detect API-error responses without depending
// on services/api/*.
export const API_ERROR_MESSAGE_PREFIX = 'API Error'

export function startsWithApiErrorPrefix(text: string): boolean {
  return (
    text.startsWith(API_ERROR_MESSAGE_PREFIX) ||
    text.startsWith(`Please run /login · ${API_ERROR_MESSAGE_PREFIX}`)
  )
}
