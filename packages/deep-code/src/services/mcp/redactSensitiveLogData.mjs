/**
 * Pure, node-testable redaction helpers for MCP debug/analytics logging.
 *
 * MCP server configs carry user-supplied headers (and URLs) that frequently hold
 * credentials — an API key, a session cookie, a bearer token, basic-auth
 * userinfo. The debug-log redaction only masked the `authorization` header, so a
 * server configured with `X-Api-Key` / `Cookie` / `X-Claude-Code-Ide-Authorization`
 * / a token query param / a `user:pass@` URL leaked its secret verbatim into the
 * MCP debug log (and analytics). These helpers mask the whole credential family.
 *
 * Bias toward OVER-redaction: a debug log never needs a header's real value, so
 * masking a benign header is harmless, whereas leaking a credential is not.
 */

// Lowercased substrings that mark a header name as credential-bearing.
const SENSITIVE_HEADER_SUBSTRINGS = [
  'authorization',
  'auth', // x-auth-token, www-authenticate, proxy-authorization, …
  'cookie',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'api-key',
  'apikey',
  'x-api', // x-api-key and the like
  'key', // x-functions-key, ocp-apim-subscription-key, x-acme-key, sec-websocket-key, …
  'session',
  'bearer',
]

const REDACTED = '[REDACTED]'

/**
 * @param {unknown} name
 * @returns {boolean} true if the header name looks like it carries a credential
 */
export function isSensitiveHeaderName(name) {
  if (typeof name !== 'string') return false
  const k = name.toLowerCase()
  return SENSITIVE_HEADER_SUBSTRINGS.some(s => k.includes(s))
}

/**
 * Return a shallow copy of a header record with every credential-bearing value
 * replaced by `[REDACTED]`. Non-object inputs are returned unchanged (callers log
 * them verbatim, e.g. `undefined` when there are no headers).
 *
 * @param {Record<string, unknown> | null | undefined} headers
 * @returns {Record<string, unknown> | null | undefined}
 */
export function redactSensitiveHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeaderName(k) ? REDACTED : v
  }
  return out
}

/**
 * Strip a URL down to a logging-safe base: drop the query string (token params),
 * the `user:pass@` userinfo (basic-auth credentials), and a trailing slash.
 * Returns undefined if the input is not a parseable URL.
 *
 * @param {unknown} urlString
 * @returns {string | undefined}
 */
export function stripUrlCredentials(urlString) {
  if (typeof urlString !== 'string') return undefined
  try {
    const url = new URL(urlString)
    url.search = ''
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}
