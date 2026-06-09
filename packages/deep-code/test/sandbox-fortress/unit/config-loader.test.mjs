import test from 'node:test'
import assert from 'node:assert/strict'

import { FORTRESS_LAYERS, parseFortressSettings } from '../../../src/sandbox-fortress/rule-engine/configLoader.mjs'
import { LAYER_RANK } from '../../../src/sandbox-fortress/rule-engine/resolveRules.mjs'

// ── F3 PR-E: parse settings.fortress → validated rulesets + effort (pure, fail-safe) ─

test('A1 absent / non-object fortress → empty result', () => {
  for (const bad of [undefined, null, 42, 'x', []]) {
    assert.deepEqual(parseFortressSettings(bad), { rulesByLayer: {}, effort: undefined, warnings: [] })
  }
})

test('A2 valid rules are grouped by layer; missing layer defaults to user', () => {
  const { rulesByLayer, effort, warnings } = parseFortressSettings({
    effort: 'high',
    rules: [
      { layer: 'org', resource: 'fs-write', pattern: '/etc/passwd', action: 'deny' },
      { resource: 'fs-write', pattern: '/tmp/x', action: 'deny' }, // no layer → user
      { layer: 'org', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
    ],
  })
  assert.equal(effort, 'high')
  assert.deepEqual(warnings, [])
  assert.deepEqual(rulesByLayer.org, [
    { layer: 'org', resource: 'fs-write', pattern: '/etc/passwd', action: 'deny' },
    { layer: 'org', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
  ])
  assert.deepEqual(rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/tmp/x', action: 'deny' }])
})

test('A3 effort: only off|high|max accepted; invalid warned + dropped', () => {
  assert.equal(parseFortressSettings({ effort: 'max' }).effort, 'max')
  assert.equal(parseFortressSettings({ effort: 'off' }).effort, 'off')
  const bad = parseFortressSettings({ effort: 'paranoid' })
  assert.equal(bad.effort, undefined)
  assert.match(bad.warnings[0], /fortress\.effort: invalid/)
})

test('A4 invalid resource / action / pattern → dropped with a warning', () => {
  const { rulesByLayer, warnings } = parseFortressSettings({
    rules: [
      { layer: 'user', resource: 'bogus', pattern: '/x', action: 'deny' },
      { layer: 'user', resource: 'fs-write', pattern: '/x', action: 'nope' },
      { layer: 'user', resource: 'fs-write', pattern: '', action: 'deny' },
      { layer: 'user', resource: 'fs-write', pattern: '   ', action: 'deny' }, // blank → rejected
      { layer: 'user', resource: 'fs-write', pattern: 5, action: 'deny' },
      null,
      'not-an-object',
      { layer: 'user', resource: 'fs-write', pattern: '/ok', action: 'deny' },
    ],
  })
  assert.deepEqual(rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/ok', action: 'deny' }])
  assert.equal(warnings.length, 7) // 5 field-invalid (incl. blank) + null + non-object
})

test('A5 invalid layer: a DENY is kept at user (protection preserved); ALLOW/ASK are dropped', () => {
  const { rulesByLayer, warnings } = parseFortressSettings({
    rules: [
      { layer: 'root', resource: 'fs-write', pattern: '/x', action: 'deny' }, // kept at user
      { layer: 'root', resource: 'fs-read', pattern: '/y', action: 'allow' }, // dropped
      { layer: 'root', resource: 'fs-read', pattern: '/z', action: 'ask' }, // dropped
    ],
  })
  assert.deepEqual(rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/x', action: 'deny' }])
  assert.match(warnings[0], /invalid layer "root".*deny kept at 'user'/)
  assert.match(warnings[1], /invalid layer "root" on a non-deny rule \(dropped\)/)
  assert.match(warnings[2], /invalid layer "root" on a non-deny rule \(dropped\)/)
})

test('A5c present-but-null/undefined/unreadable layer is INVALID (deny kept, allow/ask dropped)', () => {
  // layer: null (JSON-reachable) — present + invalid
  const r1 = parseFortressSettings({
    rules: [
      { layer: null, resource: 'fs-write', pattern: '/x', action: 'deny' }, // kept at user
      { layer: null, resource: 'fs-read', pattern: '/y', action: 'allow' }, // dropped
    ],
  })
  assert.deepEqual(r1.rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/x', action: 'deny' }])

  // a present-but-undefined layer key (crafted) on an allow → dropped, not defaulted-to-user
  const r2 = parseFortressSettings({ rules: [{ resource: 'fs-read', pattern: '/y', action: 'allow', layer: undefined }] })
  assert.deepEqual(r2.rulesByLayer, {})

  // an ABSENT layer key still defaults to user (kept)
  const r3 = parseFortressSettings({ rules: [{ resource: 'fs-read', pattern: '/y', action: 'allow' }] })
  assert.deepEqual(r3.rulesByLayer.user, [{ layer: 'user', resource: 'fs-read', pattern: '/y', action: 'allow' }])
})

test('A5d a hostile options bag (throwing normalizePattern getter) never throws', () => {
  const hostileOpts = {}
  Object.defineProperty(hostileOpts, 'normalizePattern', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('boom')
    },
  })
  let res
  assert.doesNotThrow(() => {
    res = parseFortressSettings({ rules: [{ resource: 'fs-write', pattern: '/x', action: 'deny' }] }, hostileOpts)
  })
  // falls back to the identity normalizer → the rule is still parsed
  assert.deepEqual(res.rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/x', action: 'deny' }])
})

test('A5b safeStringify: BigInt / circular invalid values warn without throwing', () => {
  let r1
  assert.doesNotThrow(() => {
    r1 = parseFortressSettings({ effort: 1n }) // BigInt effort — JSON.stringify would throw
  })
  assert.equal(r1.effort, undefined)
  assert.match(r1.warnings[0], /fortress\.effort: invalid value/)

  const circular = {}
  circular.self = circular
  let r2
  assert.doesNotThrow(() => {
    r2 = parseFortressSettings({ rules: [{ layer: 'user', resource: circular, pattern: '/x', action: 'deny' }] })
  })
  assert.deepEqual(r2.rulesByLayer, {})
  assert.match(r2.warnings[0], /invalid resource/)
})

test('A6 normalizePattern is applied to fs patterns ONLY (net-host/process-exec untouched)', () => {
  const normalizePattern = (pattern, resource) => `ABS:${resource}:${pattern}`
  const { rulesByLayer } = parseFortressSettings(
    {
      rules: [
        { layer: 'user', resource: 'fs-write', pattern: '~/.ssh/**', action: 'deny' },
        { layer: 'user', resource: 'fs-read', pattern: './secret', action: 'deny' },
        { layer: 'user', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
        { layer: 'user', resource: 'process-exec', pattern: 'rm', action: 'deny' },
      ],
    },
    { normalizePattern },
  )
  const patterns = rulesByLayer.user.map(r => r.pattern)
  assert.deepEqual(patterns, ['ABS:fs-write:~/.ssh/**', 'ABS:fs-read:./secret', 'evil.com', 'rm'])
})

test('A7 a throwing normalizer falls back to the raw pattern (never throws)', () => {
  const normalizePattern = () => {
    throw new Error('boom')
  }
  let res
  assert.doesNotThrow(() => {
    res = parseFortressSettings({ rules: [{ layer: 'user', resource: 'fs-write', pattern: '/x', action: 'deny' }] }, { normalizePattern })
  })
  assert.equal(res.rulesByLayer.user[0].pattern, '/x')
})

test('A8 metadata: only reason (string) + expiresAt (finite number) carried through', () => {
  const { rulesByLayer } = parseFortressSettings({
    rules: [
      { layer: 'user', resource: 'fs-write', pattern: '/x', action: 'deny', reason: 'why', expiresAt: 123, junk: 'drop' },
      { layer: 'user', resource: 'fs-write', pattern: '/y', action: 'deny', expiresAt: 'soon' }, // invalid expiresAt
    ],
  })
  assert.deepEqual(rulesByLayer.user[0].metadata, { reason: 'why', expiresAt: 123 })
  assert.equal('metadata' in rulesByLayer.user[1], false) // no valid metadata → omitted
  assert.equal('junk' in rulesByLayer.user[0], false) // arbitrary keys never carried
})

test('A9 fail-safe: rules not an array → warned, no throw; hostile getters skipped', () => {
  const r1 = parseFortressSettings({ rules: { not: 'array' } })
  assert.deepEqual(r1.rulesByLayer, {})
  assert.match(r1.warnings[0], /fortress\.rules: must be an array/)

  const hostile = {
    layer: 'user',
    action: 'deny',
    pattern: '/x',
    get resource() {
      throw new Error('boom')
    },
  }
  let r2
  assert.doesNotThrow(() => {
    r2 = parseFortressSettings({ rules: [hostile, { layer: 'user', resource: 'fs-write', pattern: '/ok', action: 'deny' }] })
  })
  assert.deepEqual(r2.rulesByLayer.user, [{ layer: 'user', resource: 'fs-write', pattern: '/ok', action: 'deny' }])
})

test('A10 SECURITY: a polluted Object.prototype cannot inject effort/rules', () => {
  const saved = Object.prototype.effort
  try {
    Object.prototype.effort = 'max'
    const { effort } = parseFortressSettings({}) // empty OWN object
    assert.equal(effort, undefined) // inherited 'effort' NOT read
  } finally {
    if (saved === undefined) delete Object.prototype.effort
    else Object.prototype.effort = saved
  }
})

test('A11 rule fields are read OWN-key only (inherited prototype props are NOT accepted)', () => {
  const proto = { resource: 'fs-write', action: 'deny', pattern: '/secret', layer: 'agent' }
  const inherited = Object.create(proto) // a "rule" with NO own keys
  const { rulesByLayer, warnings } = parseFortressSettings({ rules: [inherited] })
  assert.deepEqual(rulesByLayer, {}) // inherited resource not read → invalid → dropped
  assert.match(warnings[0], /invalid resource/)
})

test('A12 surrounding whitespace in a pattern is trimmed (never a padded cwd deny)', () => {
  const { rulesByLayer } = parseFortressSettings(
    { rules: [{ layer: 'user', resource: 'fs-write', pattern: '  /etc/passwd  ', action: 'deny' }] },
    { normalizePattern: p => p },
  )
  assert.equal(rulesByLayer.user[0].pattern, '/etc/passwd')
})

test('A13 a revoked-proxy / hostile rules value never throws (dropped + warned)', () => {
  const { proxy, revoke } = Proxy.revocable([], {})
  revoke()
  let res
  assert.doesNotThrow(() => {
    res = parseFortressSettings({ rules: proxy })
  })
  assert.deepEqual(res.rulesByLayer, {})
  assert.match(res.warnings[0], /could not be read|must be an array/)
})

test('B1 FORTRESS_LAYERS lists every layer (so the wiring can clear emptied layers)', () => {
  assert.deepEqual(FORTRESS_LAYERS, ['builtin-default', 'org', 'agent', 'user'])
})

test('B1b FORTRESS_LAYERS is DERIVED from LAYER_RANK (single source of truth — cannot drift)', () => {
  // The layer SET must equal LAYER_RANK's keys exactly: a layer in one but not the other
  // would silently break either the precedence sort (LAYER_RANK[layer] → undefined → NaN)
  // or the per-layer reload-clear. Pinning equality here is what makes the derivation safe.
  assert.deepEqual([...FORTRESS_LAYERS].sort(), Object.keys(LAYER_RANK).sort())
  // EVERY layer has a defined numeric rank (a missing/undefined rank → NaN compare in
  // resolveRules' precedence sort, the exact drift this derivation prevents).
  for (const layer of FORTRESS_LAYERS) {
    assert.equal(typeof LAYER_RANK[layer], 'number', `layer '${layer}' must have a numeric LAYER_RANK`)
  }
  // …and ordered by ASCENDING rank (lowest trust → highest), which the wiring relies on.
  for (let i = 1; i < FORTRESS_LAYERS.length; i++) {
    assert.ok(
      LAYER_RANK[FORTRESS_LAYERS[i - 1]] < LAYER_RANK[FORTRESS_LAYERS[i]],
      `FORTRESS_LAYERS must be ascending by LAYER_RANK (${FORTRESS_LAYERS[i - 1]} before ${FORTRESS_LAYERS[i]})`,
    )
  }
})
