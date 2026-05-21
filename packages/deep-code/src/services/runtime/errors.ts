import type { SDKAssistantMessageError } from '../../entrypoints/agentSdkTypes.js'
import type { AssistantMessage } from '../../types/message.js'

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

/**
 * Parse an "API Error: prompt is too long: N tokens > M maximum" error
 * message into structured token counts.
 */
export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  }
}

/**
 * Returns how many tokens over the limit a prompt-too-long error reports,
 * or undefined if the message isn't PTL or its errorDetails are unparseable.
 */
export function getPromptTooLongTokenGap(
  msg: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(msg) || !msg.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    msg.errorDetails,
  )
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined
  }
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

// ========== Error message constants (migrated from services/api/errors.ts) ==========
// API_ERROR_MESSAGE_PREFIX already defined above.

export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Not logged in · Please run /login'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid API key · Fix external API key'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable'
export const TOKEN_REVOKED_ERROR_MESSAGE =
  'OAuth token revoked · Please run /login'
export const CCR_AUTH_ERROR_MESSAGE =
  'Authentication error · This may be a temporary network issue, please try again'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const CUSTOM_OFF_SWITCH_MESSAGE =
  'Opus is experiencing high load, please use /model to switch to Sonnet'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'

// ========== Retry helpers (migrated from services/api/withRetry.ts) ==========

const DEFAULT_MAX_RETRIES = 10
const BASE_DELAY_MS = 500

export function getDefaultMaxRetries(): number {
  if (process.env.CLAUDE_CODE_MAX_RETRIES) {
    return parseInt(process.env.CLAUDE_CODE_MAX_RETRIES, 10)
  }
  return DEFAULT_MAX_RETRIES
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32_000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

// ========== Error format helpers (migrated from services/api/errorUtils.ts) ==========

const SSL_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
])

type ConnectionErrorDetails = {
  code: string
  message: string
  isSSLError: boolean
}

function extractConnectionErrorDetails(
  error: unknown,
): ConnectionErrorDetails | null {
  if (!error || typeof error !== 'object') return null

  let current: unknown = error
  let depth = 0
  while (current && depth < 5) {
    if (current instanceof Error) {
      const record = current as Error & { code?: unknown; cause?: unknown }
      if (typeof record.code === 'string') {
        return {
          code: record.code,
          message: current.message,
          isSSLError: SSL_ERROR_CODES.has(record.code),
        }
      }
      if (record.cause !== undefined && record.cause !== current) {
        current = record.cause
        depth++
        continue
      }
    }
    break
  }

  return null
}

export function getSSLErrorHint(error: unknown): string | null {
  const details = extractConnectionErrorDetails(error)
  if (!details?.isSSLError) return null
  return `SSL certificate error (${details.code}). If you are behind a corporate proxy or TLS-intercepting firewall, set NODE_EXTRA_CA_CERTS to your CA bundle path, or ask IT to allowlist *.anthropic.com. Run /doctor for details.`
}

function sanitizeMessageHTML(message: string): string {
  if (message.includes('<!DOCTYPE html') || message.includes('<html')) {
    const titleMatch = message.match(/<title>([^<]+)<\/title>/)
    if (titleMatch?.[1]) {
      return titleMatch[1].trim()
    }
    return ''
  }
  return message
}

type NestedAPIError = {
  error?: {
    message?: string
    error?: { message?: string }
  }
}

function hasNestedError(value: unknown): value is NestedAPIError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object' &&
    (value as { error?: unknown }).error !== null
  )
}

function extractNestedErrorMessage(error: unknown): string | null {
  if (!hasNestedError(error)) return null
  const nested = error.error

  const deepMsg = nested?.error?.message
  if (typeof deepMsg === 'string' && deepMsg.length > 0) {
    const sanitized = sanitizeMessageHTML(deepMsg)
    if (sanitized.length > 0) return sanitized
  }

  const msg = nested?.message
  if (typeof msg === 'string' && msg.length > 0) {
    const sanitized = sanitizeMessageHTML(msg)
    if (sanitized.length > 0) return sanitized
  }

  return null
}

export function formatAPIError(error: unknown): string {
  if (typeof error === 'string') return error

  const connectionDetails = extractConnectionErrorDetails(error)
  if (connectionDetails) {
    const { code, isSSLError } = connectionDetails
    if (code === 'ETIMEDOUT') {
      return 'Request timed out. Check your internet connection and proxy settings'
    }
    if (isSSLError) {
      switch (code) {
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
          return 'Unable to connect to API: SSL certificate verification failed. Check your proxy or corporate SSL certificates'
        case 'CERT_HAS_EXPIRED':
          return 'Unable to connect to API: SSL certificate has expired'
        case 'CERT_REVOKED':
          return 'Unable to connect to API: SSL certificate has been revoked'
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
          return 'Unable to connect to API: Self-signed certificate detected. Check your proxy or corporate SSL certificates'
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
        case 'HOSTNAME_MISMATCH':
          return 'Unable to connect to API: SSL certificate hostname mismatch'
        case 'CERT_NOT_YET_VALID':
          return 'Unable to connect to API: SSL certificate is not yet valid'
        default:
          return `Unable to connect to API: SSL error (${code})`
      }
    }
  }

  if (error instanceof Error && error.message === 'Connection error.') {
    if (connectionDetails?.code) {
      return `Unable to connect to API (${connectionDetails.code})`
    }
    return 'Unable to connect to API. Check your internet connection'
  }

  const message = error instanceof Error ? error.message : undefined
  if (!message) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { status?: unknown }).status !== 'undefined'
        ? (error as { status?: unknown }).status
        : 'unknown'
    return extractNestedErrorMessage(error) ?? `API error (status ${status})`
  }

  const sanitizedMessage = sanitizeMessageHTML(message)
  return sanitizedMessage !== message && sanitizedMessage.length > 0
    ? sanitizedMessage
    : message
}

// ========== Cache-control stub (Anthropic-only concept; DeepSeek no-op) ==========

/**
 * Provider-neutral stub for services/api/claude.getCacheControl. The Anthropic
 * cache_control block-level concept does not map to DeepSeek. DeepSeek runtime
 * returns undefined so callers that conditionally apply cache_control skip it.
 */
export function getCacheControl(): undefined {
  return undefined
}
