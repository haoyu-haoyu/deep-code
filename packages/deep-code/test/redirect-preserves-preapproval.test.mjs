import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redirectPreservesPreapproval } from '../src/tools/WebFetchTool/redirectPreservesPreapproval.mjs'

// Stub predicates modeling the real preapproved list semantics (kept .mjs-only so
// the test runs under the node-20 CI job, which can't strip TS types):
//   - "github.com/anthropics" is PATH-SCOPED   -> host trusted only for /anthropics*
//   - "docs.python.org"        is HOST-ONLY     -> whole host trusted
const PATH_SCOPED = new Set(['github.com'])
const isPathScopedPreapprovedHost = host => PATH_SCOPED.has(host)
const hostnameOf = url => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
const isPreapprovedUrl = url => {
  let u
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.hostname === 'docs.python.org') return true // host-only
  if (u.hostname === 'github.com') {
    // path-scoped to /anthropics with segment boundary
    return u.pathname === '/anthropics' || u.pathname.startsWith('/anthropics/')
  }
  return false
}
const deps = { isPreapprovedUrl, isPathScopedPreapprovedHost, hostnameOf }
const check = (a, b) => redirectPreservesPreapproval(a, b, deps)

test('THE FIX: path-scoped host cannot redirect out of its path scope', () => {
  assert.equal(
    check('https://github.com/anthropics/claude-code', 'https://github.com/evil/malware'),
    false,
  )
  // segment-boundary trick must also be rejected
  assert.equal(
    check('https://github.com/anthropics/x', 'https://github.com/anthropics-evil/y'),
    false,
  )
})

test('path-scoped host: in-scope redirect (same path prefix) is allowed', () => {
  assert.equal(
    check('https://github.com/anthropics/a', 'https://github.com/anthropics/b'),
    true,
  )
  assert.equal(
    check('https://github.com/anthropics', 'https://github.com/anthropics/sub'),
    true,
  )
})

test('host-only preapproved host: any same-host redirect allowed (no www regression)', () => {
  assert.equal(
    check('https://docs.python.org/3/library/os.html', 'https://docs.python.org/3/'),
    true,
  )
  assert.equal(
    check('https://docs.python.org/3/a', 'https://docs.python.org/3/b'),
    true,
  )
})

test('non-preapproved (user-approved domain): unrestricted by this guard', () => {
  assert.equal(check('https://example.com/a', 'https://example.com/b'), true)
  // A path-scoped HOST reached at a NON-preapproved path was user-approved as a
  // domain (checkPermissions asked), so this guard must not constrain it.
  assert.equal(
    check('https://github.com/someuser/repo', 'https://github.com/other/repo'),
    true,
  )
})

test('unparseable current URL we are trusting is not followed', () => {
  const stub = {
    isPreapprovedUrl: () => true,
    isPathScopedPreapprovedHost: () => true,
    hostnameOf: () => null,
  }
  assert.equal(redirectPreservesPreapproval('x', 'y', stub), false)
})

test('host-only preapproved current short-circuits before the redirect check', () => {
  const stub = {
    isPreapprovedUrl: u => u === 'cur',
    isPathScopedPreapprovedHost: () => false,
    hostnameOf: () => 'trusted.example',
  }
  assert.equal(redirectPreservesPreapproval('cur', 'anything', stub), true)
})
