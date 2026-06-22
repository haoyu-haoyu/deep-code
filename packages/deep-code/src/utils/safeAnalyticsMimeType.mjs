/**
 * Normalize a response Content-Type into a value SAFE to send to analytics.
 *
 * `tengu_binary_content_persisted` logged the raw `mimeType` (the WebFetch/MCP
 * response Content-Type) with a comment claiming it is a "safe fixed-vocabulary
 * string". It is not: the header is fully attacker-server-controlled and can
 * carry arbitrary parameters (`; charset=…; boundary=…`), injected text, or an
 * unbounded blob. This strips parameters and emits the bare `type/subtype` only
 * when it is a well-formed, length-bounded media type; anything else collapses to
 * `'other'` so a malicious/garbage Content-Type never reaches analytics verbatim.
 *
 * @param {unknown} rawMimeType
 * @returns {string} a safe `type/subtype`, `'unknown'`, or `'other'`
 */
export function safeAnalyticsMimeType(rawMimeType) {
  if (typeof rawMimeType !== 'string') return 'unknown'
  const mt = (rawMimeType.split(';')[0] ?? '').trim().toLowerCase()
  if (mt.length === 0) return 'unknown'
  // a well-formed, bounded type/subtype is useful, non-sensitive telemetry;
  // anything else (params already stripped above, so this catches garbage /
  // injected / oversized headers) is reported as 'other'.
  if (
    mt.length <= 100 &&
    /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mt)
  ) {
    return mt
  }
  return 'other'
}
