import test from 'node:test'
import assert from 'node:assert/strict'

import {
  matchesDomainPattern,
  resolveNetworkDecision,
} from '../../../src/sandbox-fortress/networkDecision.mjs'

// ── network decision core (F2-A: session-global network deny, made testable) ──
// Mirrors @anthropic-ai/sandbox-runtime filterNetworkRequest's domain matching +
// deny-first ordering, plus the legacy adapter's allowManagedDomainsOnly block.
// SCOPE: session-global only — NOT per-tool (blocked upstream), NOT macOS kernel
// network isolation (impossible). This is the node-testable seam + the DeepCode-
// side denylist enforcement wired into the live network callback.

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
