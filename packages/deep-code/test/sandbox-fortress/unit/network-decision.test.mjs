import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  matchesDomainPattern,
  resolveNetworkDecision,
} from '../../../src/sandbox-fortress/networkDecision.mjs'

// ── network decision core (F2-A: session-global network deny, made testable) ──
// Mirrors @anthropic-ai/sandbox-runtime filterNetworkRequest's domain matching +
// deny-first ordering, plus the legacy adapter's allowManagedDomainsOnly block.
// SCOPE: session-global per-HOST policy only — NOT per-tool (blocked upstream).
// OS confinement-to-the-proxy IS kernel-enforced on both platforms (Linux netns /
// macOS seatbelt deny-default); see docs/sandbox-fortress/network-isolation-parity.md.
// This is the node-testable decision seam + the DeepCode-side deny backstop.

// --- matchesDomainPattern: behaviour-equivalent to the runtime (valid patterns) --

test('exact host match is case-insensitive', () => {
  assert.equal(matchesDomainPattern('Example.COM', 'example.com'), true)
  assert.equal(matchesDomainPattern('example.com', 'example.com'), true)
  assert.equal(matchesDomainPattern('evil.com', 'example.com'), false)
})

test('wildcard *.base matches any SUBDOMAIN but NOT the base domain', () => {
  assert.equal(matchesDomainPattern('api.example.com', '*.example.com'), true)
  assert.equal(matchesDomainPattern('a.b.example.com', '*.example.com'), true)
  assert.equal(matchesDomainPattern('API.Example.com', '*.EXAMPLE.com'), true) // case-insensitive
  assert.equal(matchesDomainPattern('example.com', '*.example.com'), false) // base excluded
  assert.equal(matchesDomainPattern('notexample.com', '*.example.com'), false)
  assert.equal(matchesDomainPattern('example.com.evil.com', '*.example.com'), false)
})

test('an empty / nullish / non-string pattern matches NOTHING (security: no spurious match)', () => {
  // stricter than the runtime (which would throw) — a malformed pattern must
  // never match, so it can't become a spurious deny or (worse) an allowlist bypass.
  assert.equal(matchesDomainPattern('example.com', undefined), false)
  assert.equal(matchesDomainPattern(undefined, undefined), false)
  assert.equal(matchesDomainPattern('', ''), false) // empty host vs empty pattern → no match
  assert.equal(matchesDomainPattern('anything.com', ''), false)
  assert.equal(matchesDomainPattern('anything.com', null), false)
  assert.equal(matchesDomainPattern('anything.com', 123), false)
  // a nullish HOST against a real pattern simply doesn't match
  assert.equal(matchesDomainPattern(undefined, 'example.com'), false)
})

test('an empty-string entry in a list never causes a spurious allow/deny', () => {
  // an empty allowed pattern must NOT allow a host (bypass guard)
  assert.equal(resolveNetworkDecision({ host: 'evil.com', allowedDomains: [''] }), 'ask')
  // an empty denied pattern must NOT deny a host
  assert.equal(resolveNetworkDecision({ host: 'good.com', deniedDomains: [''] }), 'ask')
})

// --- resolveNetworkDecision: deny-first, then allow, then managed-only -------

test('deny wins over allow (deny-first ordering)', () => {
  assert.equal(
    resolveNetworkDecision({
      host: 'api.example.com',
      deniedDomains: ['*.example.com'],
      allowedDomains: ['api.example.com'],
    }),
    'deny',
  )
})

test('an allowed host returns allow', () => {
  assert.equal(
    resolveNetworkDecision({ host: 'api.example.com', allowedDomains: ['*.example.com'] }),
    'allow',
  )
})

test('allowManagedDomainsOnly blocks anything not explicitly allowed', () => {
  assert.equal(
    resolveNetworkDecision({ host: 'random.io', allowManagedDomainsOnly: true }),
    'deny',
  )
  // but an explicitly-allowed host still passes under managed-only
  assert.equal(
    resolveNetworkDecision({
      host: 'ok.com',
      allowedDomains: ['ok.com'],
      allowManagedDomainsOnly: true,
    }),
    'allow',
  )
})

test('default (no lists, managed-only off) defers to the host ask-callback', () => {
  assert.equal(resolveNetworkDecision({ host: 'anything.com' }), 'ask')
  assert.equal(resolveNetworkDecision({ host: 'anything.com', allowedDomains: [], deniedDomains: [] }), 'ask')
})

test('the denylist blocks a host even when managed-only is off (the new capability)', () => {
  assert.equal(
    resolveNetworkDecision({ host: 'tracker.evil.com', deniedDomains: ['*.evil.com'] }),
    'deny',
  )
})

test('empty/garbage args do not throw and default to ask', () => {
  assert.equal(resolveNetworkDecision({}), 'ask')
  assert.equal(resolveNetworkDecision(), 'ask')
  assert.equal(resolveNetworkDecision({ host: 'x.com', deniedDomains: null, allowedDomains: 'nope' }), 'ask')
})

// --- F2-D: deny-path edges (the deny DECISION matrix, provable on every OS) ---
// Complements the nightly Linux-only enforcement E2E (sandbox-network-e2e.mjs):
// these prove the deny LOGIC offline, on macOS and Linux alike.

test('a wildcard deny blocks subdomains but NOT the base (decision level)', () => {
  assert.equal(resolveNetworkDecision({ host: 'a.evil.com', deniedDomains: ['*.evil.com'] }), 'deny')
  // the base is NOT matched by *.evil.com → no deny; nothing else matches → ask
  assert.equal(resolveNetworkDecision({ host: 'evil.com', deniedDomains: ['*.evil.com'] }), 'ask')
})

test('deny matches any entry in a multi-entry denylist (allow likewise)', () => {
  assert.equal(resolveNetworkDecision({ host: 'b.com', deniedDomains: ['a.com', 'b.com', 'c.com'] }), 'deny')
  assert.equal(resolveNetworkDecision({ host: 'mid.com', allowedDomains: ['x.com', 'mid.com', 'y.com'] }), 'allow')
})

test('deny matching is case-insensitive (exact and wildcard)', () => {
  assert.equal(resolveNetworkDecision({ host: 'evil.com', deniedDomains: ['EVIL.com'] }), 'deny')
  assert.equal(resolveNetworkDecision({ host: 'API.Evil.com', deniedDomains: ['*.evil.COM'] }), 'deny')
})

test('deny wins over a WILDCARD allow too (deny-first regardless of pattern shape)', () => {
  assert.equal(
    resolveNetworkDecision({
      host: 'api.example.com',
      deniedDomains: ['api.example.com'],
      allowedDomains: ['*.example.com'],
    }),
    'deny',
  )
})

test('deny-first holds even under allowManagedDomainsOnly', () => {
  // denied subdomain stays denied whether or not managed-only is on
  assert.equal(
    resolveNetworkDecision({
      host: 'tracker.evil.com',
      deniedDomains: ['*.evil.com'],
      allowManagedDomainsOnly: true,
    }),
    'deny',
  )
  // a host that is BOTH allowed and denied under managed-only → deny still wins
  assert.equal(
    resolveNetworkDecision({
      host: 'ok.com',
      deniedDomains: ['ok.com'],
      allowedDomains: ['ok.com'],
      allowManagedDomainsOnly: true,
    }),
    'deny',
  )
})

// --- F2-D: the platform-parity doc must exist + state the honest invariants ---

test('the network-isolation parity doc states the honest invariants (regression guard)', () => {
  const docPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../..',
    'docs/sandbox-fortress/network-isolation-parity.md',
  )
  assert.equal(existsSync(docPath), true, `expected ${docPath} to exist`)
  const doc = readFileSync(docPath, 'utf8')
  // Lock the EXACT corrected propositions (targeted regexes, not loose words), so a
  // regression that re-introduces a specific inaccuracy fails here:
  const required = [
    [/resolveNetworkDecision/, 'name the decision function'],
    [/deny-first/i, 'state deny-first ordering'],
    // the callback backstop reads the SETTINGS denylist only — not the runtime's
    // WebFetch permission `domain:` denies (the round-1 over-claim)
    [/settings denylist only/i, 'scope the callback backstop to the settings denylist'],
    [/not the\s+permission-rule denies/i, 'note it excludes the permission-rule denies'],
    // both platforms kernel-confine TCP/IP to the proxy (Linux netns / macOS seatbelt)
    [/unshare-net/, 'name the Linux netns mechanism'],
    [/deny default/i, 'name the macOS seatbelt deny-default mechanism'],
    // per-host refusal scoped to HTTP/CONNECT 403, with SOCKS rejection noted
    [/403 Forbidden/, 'state the HTTP(S)/CONNECT 403 Forbidden refusal'],
    [/SOCKS host-filter rejection/i, 'state SOCKS-routed traffic is rejected separately'],
    // TCP/IP scope caveat: lock the PLATFORM-SPECIFIC unix-socket/local-binding
    // matrix (not just that the knob names appear), so a regression to a false
    // cross-platform claim fails here:
    [/Linux only `?allowAllUnixSockets/i, 'state Linux relaxes only via allowAllUnixSockets'],
    [/`?allowUnixSockets`? is not supported/i, 'state path-specific allowUnixSockets is unsupported on Linux'],
    [/`?allowLocalBinding`? is a macOS/i, 'state allowLocalBinding is a macOS-only knob'],
    // CI honesty: no macOS CI leg (do not over-claim macOS coverage)
    [/no macOS\s+CI leg/i, 'state there is no macOS CI leg'],
    [/per-tool network deny is not enforceable/i, 'state per-tool deny is not enforceable'],
  ]
  for (const [re, why] of required) {
    assert.match(doc, re, `parity doc must ${why} (/${re.source}/)`)
  }
})
