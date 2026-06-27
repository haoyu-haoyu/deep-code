/**
 * The URL forms an MCP server config should be matched against for a URL-based
 * policy (deny/allow) decision.
 *
 * A claude.ai connector in a remote session arrives with its real vendor URL
 * rewritten to route through the CCR/session-ingress proxy, preserving the
 * original in the `mcp_url` query param. The dedup signature already unwraps
 * that (getMcpServerSignature uses unwrapCcrProxyUrl), but the denylist matched
 * ONLY the raw wrapped URL — so a denied vendor arriving CCR-wrapped slipped
 * past the denylist (fail-open: the wrapped URL doesn't match the vendor
 * pattern). Returning both the raw and the unwrapped form lets the caller deny
 * on EITHER, which can only ADD matches (strictly tightening) — it never drops
 * a match the raw URL already produced.
 *
 * @param {string | null | undefined} rawUrl  the server's configured URL
 * @param {string | null | undefined} unwrappedUrl  unwrapCcrProxyUrl(rawUrl)
 * @returns {string[]} the distinct URLs to test against a policy pattern
 */
export function mcpPolicyUrlCandidates(rawUrl, unwrappedUrl) {
  if (!rawUrl) return []
  if (unwrappedUrl && unwrappedUrl !== rawUrl) return [rawUrl, unwrappedUrl]
  return [rawUrl]
}
