import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fortressLinuxUnenforcedWriteWarnings,
  fortressRulesToFsDelta,
  isEmptyFsDelta,
} from '../../../src/sandbox-fortress/rule-engine/fsProjector.mjs'

// ── F3 PR-D: fortress rules → OS-enforceable filesystem DENY delta (provably-safe cut)
// Only fs-write DENY rules that are ABSOLUTE and GLOB-FREE (after a trailing /** strip)
// are projected — the only shape the OS reproduces faithfully and never fail-open:
//   • exact file / '/path/**' subtree → faithful; exact dir → over-block (safe).
// NOT projected (would diverge / over-grant — warned + deferred to the per-call hook):
//   • fs-write ALLOW (OS allowWrite is a subtree grant → over-grant / fail-open)
//   • any glob (* ? [ ] mid-**) — fortress vs OS glob grammars disagree
//   • non-absolute (cwd-re-scoped) ; fs-read (allowRead-precedence fail-open)

test('A1 empty / non-array input → an empty deny delta', () => {
  assert.deepEqual(fortressRulesToFsDelta([]), { denyWrite: [] })
  assert.deepEqual(fortressRulesToFsDelta(undefined), { denyWrite: [] })
  assert.deepEqual(fortressRulesToFsDelta('nope'), { denyWrite: [] })
})

test('A2 absolute glob-free fs-write DENY maps to denyWrite (file, subtree, exact dir)', () => {
  const rules = [
    { layer: 'org', resource: 'fs-write', pattern: '/etc/passwd', action: 'deny' }, // exact file
    { layer: 'org', resource: 'fs-write', pattern: '/etc/secret/**', action: 'deny' }, // subtree
    { layer: 'user', resource: 'fs-write', pattern: '/var/lib', action: 'deny' }, // exact dir (safe over-block)
  ]
  assert.deepEqual(fortressRulesToFsDelta(rules), {
    denyWrite: ['/etc/passwd', '/etc/secret/**', '/var/lib'],
  })
})

test('A3 fs-write ALLOW is NEVER projected (OS allowWrite is a subtree grant → over-grant)', () => {
  const rules = [
    { layer: 'user', resource: 'fs-write', pattern: '/workspace/build', action: 'allow' },
    { layer: 'user', resource: 'fs-write', pattern: '/', action: 'allow' }, // worst-case whole-tree grant
  ]
  const delta = fortressRulesToFsDelta(rules)
  assert.deepEqual(delta, { denyWrite: [] })
  assert.equal('allowWrite' in delta, false)
})

test('A4 glob + non-absolute + fs-read denies are NOT projected (diverge / fail-open)', () => {
  const rules = [
    { layer: 'org', resource: 'fs-write', pattern: '/home/*/.ssh', action: 'deny' }, // mid glob
    { layer: 'org', resource: 'fs-write', pattern: '/a[bc].key', action: 'deny' }, // bracket char-class
    { layer: 'org', resource: 'fs-write', pattern: '/a**b', action: 'deny' }, // mid ** crosses / in OS
    { layer: 'org', resource: 'fs-write', pattern: 'secrets/**', action: 'deny' }, // relative
    { layer: 'org', resource: 'fs-write', pattern: '~/.ssh/**', action: 'deny' }, // home-relative
    { layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny' }, // fs-read deferred
    { layer: 'org', resource: 'fs-write', pattern: '/etc/**', action: 'deny' }, // trailing /** only → kept
  ]
  // only the trailing-/** subtree survives
  assert.deepEqual(fortressRulesToFsDelta(rules), { denyWrite: ['/etc/**'] })
})

test('A5 ask / net-host / process-exec are NOT projected', () => {
  const rules = [
    { layer: 'org', resource: 'fs-write', pattern: '/x', action: 'ask' },
    { layer: 'org', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
    { layer: 'org', resource: 'process-exec', pattern: '/bin/rm', action: 'deny' },
  ]
  assert.deepEqual(fortressRulesToFsDelta(rules), { denyWrite: [] })
})

test('A6 dedupe + input order preserved (stable wrapped command)', () => {
  const rules = [
    { layer: 'org', resource: 'fs-write', pattern: '/a', action: 'deny' },
    { layer: 'user', resource: 'fs-write', pattern: '/b', action: 'deny' },
    { layer: 'agent', resource: 'fs-write', pattern: '/a', action: 'deny' }, // dup
  ]
  assert.deepEqual(fortressRulesToFsDelta(rules).denyWrite, ['/a', '/b'])
})

test('A7 malformed / hostile-getter rules are skipped, never throw, never spurious', () => {
  const hostile = {
    layer: 'org',
    action: 'deny',
    get resource() {
      throw new Error('boom')
    },
    pattern: '/x',
  }
  const rules = [
    null,
    42,
    hostile,
    { layer: 'org', resource: 'fs-write', action: 'deny' }, // no pattern
    { layer: 'org', resource: 'fs-write', pattern: '', action: 'deny' }, // empty pattern
    { layer: 'org', resource: 'fs-write', pattern: 5, action: 'deny' }, // non-string
    { layer: 'org', resource: 'fs-write', pattern: '/ok', action: 'deny' },
  ]
  let delta
  assert.doesNotThrow(() => {
    delta = fortressRulesToFsDelta(rules)
  })
  assert.deepEqual(delta.denyWrite, ['/ok'])
})

test('B1 isEmptyFsDelta detects the passthrough (inert) signal', () => {
  assert.equal(isEmptyFsDelta({ denyWrite: [] }), true)
  assert.equal(isEmptyFsDelta(null), true)
  assert.equal(isEmptyFsDelta(undefined), true)
  assert.equal(isEmptyFsDelta({ denyWrite: ['/x'] }), false)
})

test('C1 unenforced-write warning flags the fs-write DENIES that are NOT projected', () => {
  const rules = [
    { layer: 'org', resource: 'fs-write', pattern: '/home/*/.ssh', action: 'deny' }, // glob → warn
    { layer: 'org', resource: 'fs-write', pattern: '/a[bc].key', action: 'deny' }, // bracket → warn
    { layer: 'org', resource: 'fs-write', pattern: 'secrets/**', action: 'deny' }, // relative → warn
    { layer: 'org', resource: 'fs-write', pattern: '~/.ssh/**', action: 'deny' }, // home-relative → warn
    { layer: 'org', resource: 'fs-write', pattern: '/etc/**', action: 'deny' }, // projected → NO warn
    { layer: 'org', resource: 'fs-write', pattern: '/etc/passwd', action: 'deny' }, // projected → NO warn
    { layer: 'org', resource: 'fs-write', pattern: '/x/*', action: 'allow' }, // allow → NOT a deny → no warn
    { layer: 'org', resource: 'fs-read', pattern: '/s/*', action: 'deny' }, // fs-read → no warn
  ]
  assert.deepEqual(fortressLinuxUnenforcedWriteWarnings(rules), [
    'fs-write deny /home/*/.ssh',
    'fs-write deny /a[bc].key',
    'fs-write deny secrets/**',
    'fs-write deny ~/.ssh/**',
  ])
})

test('C2 unenforced-write warning is defensive (empty/garbage/throwing → no throw, no spurious)', () => {
  assert.deepEqual(fortressLinuxUnenforcedWriteWarnings([]), [])
  assert.deepEqual(fortressLinuxUnenforcedWriteWarnings(undefined), [])
  const hostile = {
    layer: 'org',
    action: 'deny',
    get resource() {
      throw new Error('boom')
    },
    pattern: '/x/*',
  }
  let w
  assert.doesNotThrow(() => {
    w = fortressLinuxUnenforcedWriteWarnings([hostile, null, 42, { resource: 'fs-write', action: 'deny', pattern: '' }])
  })
  assert.deepEqual(w, [])
})
