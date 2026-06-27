import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mcpPolicyUrlCandidates } from '../src/utils/mcp/mcpPolicyUrlCandidates.mjs'

// A stand-in for the real unwrapCcrProxyUrl: returns the mcp_url param if the
// URL routes through the CCR proxy, else the URL unchanged.
const unwrap = url => {
  if (!url.includes('/v2/session_ingress/shttp/mcp/')) return url
  try {
    return new URL(url).searchParams.get('mcp_url') || url
  } catch {
    return url
  }
}

const proxyWrap = vendor =>
  `https://api.anthropic.com/v2/session_ingress/shttp/mcp/?mcp_url=${encodeURIComponent(vendor)}`

test('a plain vendor URL yields just itself (unwrap is a no-op)', () => {
  const u = 'https://evil.com/mcp'
  assert.deepEqual(mcpPolicyUrlCandidates(u, unwrap(u)), [u])
})

test('THE FIX: a CCR-wrapped URL yields BOTH the wrapped and the unwrapped vendor URL', () => {
  const wrapped = proxyWrap('https://evil.com/mcp')
  const candidates = mcpPolicyUrlCandidates(wrapped, unwrap(wrapped))
  assert.deepEqual(candidates, [wrapped, 'https://evil.com/mcp'])
  // The denylist pattern for the vendor now has a candidate to match.
  assert.ok(candidates.includes('https://evil.com/mcp'))
})

test('empty / missing URL yields no candidates', () => {
  assert.deepEqual(mcpPolicyUrlCandidates('', unwrap('')), [])
  assert.deepEqual(mcpPolicyUrlCandidates(null, null), [])
  assert.deepEqual(mcpPolicyUrlCandidates(undefined, undefined), [])
})

test('no duplicate when unwrapped equals raw', () => {
  const u = 'https://vendor.example/mcp'
  // Even if the caller passes the same value as "unwrapped", do not duplicate.
  assert.deepEqual(mcpPolicyUrlCandidates(u, u), [u])
})

test('strictly additive: the raw URL is always the first candidate', () => {
  // The existing raw match is never dropped — the unwrapped form is only ADDED.
  const wrapped = proxyWrap('https://denied.test/x')
  const candidates = mcpPolicyUrlCandidates(wrapped, unwrap(wrapped))
  assert.equal(candidates[0], wrapped)
})
