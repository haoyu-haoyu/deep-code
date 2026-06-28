// WebFetch auto-allows (no user prompt) a URL whose host is preapproved. Some
// preapproved entries are PATH-SCOPED (e.g. "github.com/anthropics"): the host is
// trusted ONLY for that path prefix, and the REST of the host is explicitly
// untrusted (see preapproved.ts). But redirects are auto-followed by
// isPermittedRedirect, which pins the HOST (+/- www) and NOT the path — so without
// this guard a same-host redirect could silently escape the path scope
// (github.com/anthropics/x -> github.com/other-owner/malware) and fetch an untrusted
// page into the model with no user prompt.
//
// This decides whether following currentUrl -> redirectUrl keeps a PATH-SCOPED
// preapproval intact. It is ANDed with isPermittedRedirect at the redirect-follow
// site; a false result means the redirect is surfaced to the user (treated like a
// cross-host redirect) instead of being followed silently.
//
// It deliberately constrains ONLY the path-scoped-preapproval case:
//  - currentUrl not preapproved at all (a user-approved domain, or an "ask" grant) ->
//    unrestricted here; the user approved the whole domain, and isPermittedRedirect's
//    host pin already matches that grant.
//  - currentUrl preapproved via a HOST-ONLY entry (e.g. docs.python.org) -> unrestricted;
//    the whole host is trusted, so a +/- www or any-path same-host redirect is fine
//    (avoids a UX regression where apex<->www redirects on a trusted host get surfaced).
//  - currentUrl preapproved via a PATH-SCOPED entry -> the redirect target must ALSO be
//    preapproved (stay in scope), else it is not followed.
//
// Pure value-in/value-out (impure host parsing + the preapproval predicates injected)
// so it is node-testable.
//
// @param {string} currentUrl                              the current hop's URL
// @param {string} redirectUrl                             the proposed redirect target
// @param {object} deps
// @param {(url: string) => boolean} deps.isPreapprovedUrl
// @param {(hostname: string) => boolean} deps.isPathScopedPreapprovedHost
// @param {(url: string) => string | null} deps.hostnameOf returns hostname or null if unparseable
// @returns {boolean} true => safe to follow w.r.t. preapproval scope; false => surface instead
export function redirectPreservesPreapproval(
  currentUrl,
  redirectUrl,
  { isPreapprovedUrl, isPathScopedPreapprovedHost, hostnameOf },
) {
  // Only the path-scoped-preapproval auto-allow needs the extra constraint.
  if (!isPreapprovedUrl(currentUrl)) return true

  const host = hostnameOf(currentUrl)
  if (host == null) return false // can't parse the host we're trusting -> don't follow
  if (!isPathScopedPreapprovedHost(host)) return true // host-only trusted: any same-host redirect ok

  // Path-scoped host: the redirect must stay within a preapproved scope.
  return isPreapprovedUrl(redirectUrl)
}
