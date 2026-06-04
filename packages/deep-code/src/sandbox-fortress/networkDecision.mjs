// Pure, dependency-free network allow/deny/ask decision for the Sandbox Fortress
// (mirrors sandboxAvailability.mjs's pure-core style). It reproduces the exact
// domain-matching + ordering of @anthropic-ai/sandbox-runtime's
// filterNetworkRequest (dist/sandbox/sandbox-manager.js) PLUS the
// allowManagedDomainsOnly short-circuit the legacy adapter's wrapped network
// callback applies — so the SESSION-GLOBAL network decision is node-testable and
// can be enforced DeepCode-side, not only inside the runtime's module-global config.
//
// SCOPE (honest): this is session-global network policy. It does NOT make
// PER-TOOL networkMode enforceable — that needs a per-connection tool identity
// the sandbox-runtime proxy doesn't expose (one shared proxy per session; see
// types.ts's @deprecated networkMode + the F2.x roadmap). And on macOS the OS
// cannot kernel-isolate network the way Linux bwrap netns can; network control
// there is proxy-routing + this callback. No cross-platform kernel-network claim.

/**
 * Does `hostname` match `pattern`? For every VALID (non-empty string) pattern
 * this is behaviour-equivalent to the runtime's matchesDomainPattern:
 * `*.example.com` matches any SUBDOMAIN (not the base domain), everything else
 * is an exact match; both case-insensitive.
 *
 * It diverges only on garbage input, intentionally and more strictly than the
 * runtime (which assumes non-null and would throw): an empty / nullish /
 * non-string pattern matches NOTHING. A security matcher must never let a
 * malformed empty pattern become a spurious match — neither a spurious deny nor
 * (worse) an allowlist bypass.
 * @param {string} hostname
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesDomainPattern(hostname, pattern) {
  if (typeof pattern !== 'string' || pattern === '') return false
  const host = String(hostname ?? '').toLowerCase()
  const pat = pattern.toLowerCase()
  if (pat.startsWith('*.')) {
    return host.endsWith('.' + pat.slice(2))
  }
  return host === pat
}

function matchesAny(host, patterns) {
  return Array.isArray(patterns) && patterns.some(p => matchesDomainPattern(host, p))
}

/**
 * Resolve the network decision for a host, deny-before-allow (the runtime's
 * ordering), then the allowManagedDomainsOnly global block, else defer ('ask').
 * @param {object} args
 * @param {string} args.host
 * @param {string[]} [args.deniedDomains]   explicit denylist (highest priority)
 * @param {string[]} [args.allowedDomains]  explicit allowlist
 * @param {boolean} [args.allowManagedDomainsOnly]  session-global "managed only" block
 * @returns {'deny'|'allow'|'ask'}
 */
export function resolveNetworkDecision({
  host,
  deniedDomains = [],
  allowedDomains = [],
  allowManagedDomainsOnly = false,
} = {}) {
  if (matchesAny(host, deniedDomains)) return 'deny' // deny wins over allow
  if (matchesAny(host, allowedDomains)) return 'allow'
  if (allowManagedDomainsOnly) return 'deny' // nothing matched + managed-only → block
  return 'ask' // defer to the host ask-callback
}
