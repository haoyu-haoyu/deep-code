import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_RANK,
  LAYER_RANK,
  buildCacheFriendlyConfigSummary,
  parsePattern,
  patternMatches,
  patternSpecificity,
  resolveEffectiveRules,
  resolveResourceAction,
  resolveResourceDecision,
} from '../../../src/sandbox-fortress/rule-engine/resolveRules.mjs'

// ── F3 Layer-3 rule-resolution core (pure, node-testable, NOT wired live) ────
// Model: DENY-FIRST, ABSOLUTE — any matching deny wins, no allow override (the
// trust-gated escape hatch is DEFERRED; it needs glob-coverage semantics to be
// fail-open-safe). Fail-safe (never throws, malformed pattern matches nothing),
// deterministic (explicit `now`), cache-stable (static digest excludes volatile
// fields).

const NOW = 1_000_000
const r = (layer, resource, pattern, action, metadata) => ({
  layer,
  resource,
  pattern,
  action,
  ...(metadata ? { metadata } : {}),
})

// ── A. patternMatches: fs/process glob + net-host delegation ────────────────

test('A1 literal exact match (and a near-miss)', () => {
  assert.equal(patternMatches('fs-read', '/etc/hosts', '/etc/hosts'), true)
  assert.equal(patternMatches('fs-read', '/etc/hosts', '/etc/hostsX'), false)
})

test('A2 `*` matches within ONE segment, not across `/`', () => {
  assert.equal(patternMatches('fs-write', '/a/*', '/a/b'), true)
  assert.equal(patternMatches('fs-write', '/a/*', '/a/b/c'), false)
})

test('A3 `**` crosses `/`, and a trailing `/**` matches the prefix dir itself', () => {
  assert.equal(patternMatches('fs-read', '/a/**', '/a/b/c'), true)
  assert.equal(patternMatches('fs-read', '/a/**', '/a'), true) // prefix dir
  assert.equal(patternMatches('fs-read', '/a/**', '/a/b'), true)
  assert.equal(patternMatches('fs-read', '/a/**', '/ax'), false) // not a prefix of /a
})

test('A4 `?` matches exactly one non-`/` char', () => {
  assert.equal(patternMatches('fs-read', '/a/?', '/a/b'), true)
  assert.equal(patternMatches('fs-read', '/a/?', '/a/bc'), false)
  assert.equal(patternMatches('fs-read', '/a/?', '/a/'), false)
})

test('A5 `:` and other chars are LITERAL (process-exec cmd:* shape; no regex injection)', () => {
  assert.equal(patternMatches('process-exec', 'git:*', 'git:status'), true)
  assert.equal(patternMatches('process-exec', 'npm*', 'npm-run'), true)
  // a `.` is literal, not "any char": `a.b` does not match `axb`
  assert.equal(patternMatches('process-exec', 'a.b', 'axb'), false)
  // brackets are literal (no regex character class)
  assert.equal(patternMatches('fs-read', '/a[b]', '/a[b]'), true)
  assert.equal(patternMatches('fs-read', '/a[b]', '/ab'), false)
})

test('A6 net-host delegates to matchesDomainPattern (case-insensitive subdomain)', () => {
  assert.equal(patternMatches('net-host', '*.example.com', 'api.example.com'), true)
  assert.equal(patternMatches('net-host', '*.example.com', 'example.com'), false)
  assert.equal(patternMatches('net-host', 'API.X.COM', 'api.x.com'), true)
})

test('A7 fail-safe: empty / nullish / unknown-resource / bad target → false, never throws', () => {
  assert.equal(patternMatches('fs-read', '', '/x'), false)
  assert.equal(patternMatches('fs-read', null, '/x'), false)
  assert.equal(patternMatches('bogus', '/x', '/x'), false)
  assert.equal(patternMatches('fs-read', '/x', null), false)
  assert.equal(patternMatches('fs-read', '/x', undefined), false)
})

// ── B. patternSpecificity ────────────────────────────────────────────────────

const moreSpecific = (resource, a, b) => {
  // returns true iff a is strictly more specific than b
  const sa = patternSpecificity(resource, a)
  const sb = patternSpecificity(resource, b)
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i]
  }
  return false
}

test('B1 more literals → more specific', () => {
  assert.equal(moreSpecific('fs-read', '/secrets/master.key', '/secrets/**'), true)
})

test('B2 a real child is more specific than a trailing `/**` (which contributes 0 segments)', () => {
  assert.equal(moreSpecific('fs-read', '/secrets/x', '/secrets/**'), true)
})

test('B3 fewer wildcards → more specific at equal literals/segments', () => {
  assert.equal(moreSpecific('fs-read', '/a/*/c', '/a/**'), true)
})

test('B4 malformed pattern → least sentinel, loses every comparison', () => {
  assert.deepEqual(patternSpecificity('fs-read', ''), [-1, -1, -1, -1])
  assert.equal(moreSpecific('fs-read', '/a', ''), true)
})

test('B5 net-host exact > wildcard', () => {
  assert.equal(moreSpecific('net-host', 'api.example.com', '*.example.com'), true)
})

// ── C. resolveEffectiveRules: merge / validate / expire / dedupe / order ────

test('C1 drops malformed rules (bad resource/action, empty pattern, missing layer)', () => {
  const eff = resolveEffectiveRules({
    user: [
      r('user', 'fs-read', '/ok', 'allow'),
      r('user', 'bogus-resource', '/x', 'allow'),
      r('user', 'fs-read', '/x', 'bogus-action'),
      r('user', 'fs-read', '', 'allow'),
      { resource: 'fs-read', pattern: '/x', action: 'allow' }, // no layer, no bucket fallback? bucket=user
      null,
      42,
    ],
  })
  // the no-layer rule falls back to its bucket 'user'; the 4 truly-bad ones drop
  assert.equal(eff.length, 2)
  assert.ok(eff.every(x => x.resource === 'fs-read' && x.action === 'allow'))
})

test('C2 expiry: dropped when now ≥ expiresAt; kept when now omitted; NaN/absent never expire', () => {
  const rules = { org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: 500 })] }
  assert.equal(resolveEffectiveRules(rules, { now: NOW }).length, 0) // expired
  assert.equal(resolveEffectiveRules(rules).length, 1) // now omitted → kept
  assert.equal(resolveEffectiveRules(rules, { now: 400 }).length, 1) // before expiry
  assert.equal(
    resolveEffectiveRules({ org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: Number.NaN })] }, { now: NOW }).length,
    1,
  )
  assert.equal(
    resolveEffectiveRules({ org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: Infinity })] }, { now: NOW }).length,
    1,
  )
})

test('C3 dedupes identical (layer,resource,action,pattern); net-host case-folded', () => {
  assert.equal(
    resolveEffectiveRules({ user: [r('user', 'fs-read', '/a', 'allow'), r('user', 'fs-read', '/a', 'allow')] }).length,
    1,
  )
  assert.equal(
    resolveEffectiveRules({ user: [r('user', 'net-host', 'API.com', 'deny'), r('user', 'net-host', 'api.com', 'deny')] }).length,
    1,
  )
})

test('C4 same (layer,resource,pattern) with DIFFERENT action → both kept (real conflict)', () => {
  const eff = resolveEffectiveRules({ user: [r('user', 'fs-read', '/a', 'allow'), r('user', 'fs-read', '/a', 'deny')] })
  assert.equal(eff.length, 2)
})

test('C5 DETERMINISM: shuffled input + Record vs FortressRuleset[] → byte-identical', () => {
  const rules = [
    r('user', 'fs-read', '/a', 'allow'),
    r('org', 'fs-write', '/b/**', 'deny'),
    r('builtin-default', 'net-host', '*.x.com', 'ask'),
    r('agent', 'process-exec', 'git:*', 'allow'),
  ]
  const asRecord = resolveEffectiveRules({
    user: [rules[0]],
    org: [rules[1]],
    'builtin-default': [rules[2]],
    agent: [rules[3]],
  })
  const shuffledRuleset = resolveEffectiveRules([
    { layer: 'agent', rules: [rules[3]] },
    { layer: 'builtin-default', rules: [rules[2]] },
    { layer: 'user', rules: [rules[0]] },
    { layer: 'org', rules: [rules[1]] },
  ])
  assert.equal(JSON.stringify(asRecord), JSON.stringify(shuffledRuleset))
})

test('C6 input is never mutated; accepts all three input shapes', () => {
  const original = { user: [r('user', 'fs-read', '/a', 'allow')] }
  const snapshot = JSON.stringify(original)
  resolveEffectiveRules(original)
  assert.equal(JSON.stringify(original), snapshot) // unmutated
  // {layer,rules}[] shape
  assert.equal(resolveEffectiveRules([{ layer: 'user', rules: [r('user', 'fs-read', '/a', 'allow')] }]).length, 1)
  // garbage shapes don't throw
  assert.deepEqual(resolveEffectiveRules(undefined), [])
  assert.deepEqual(resolveEffectiveRules(null), [])
  assert.deepEqual(resolveEffectiveRules(42), [])
})

test('C7 a valid-string pattern with literal brackets is KEPT (brackets are not regex classes)', () => {
  const eff = resolveEffectiveRules({ user: [r('user', 'fs-read', '/a[b', 'deny')] })
  assert.equal(eff.length, 1)
  assert.equal(patternMatches('fs-read', '/a[b', '/a[b'), true) // matches its literal target
})

test('C8 dedupe of canonically-equal rules is METADATA-deterministic (order-independent)', () => {
  // two rules identical except for metadata must collapse to ONE, and WHICH
  // metadata survives must NOT depend on input order (else the digest/provenance
  // flaps). Sort-then-dedupe keeps the sort-first (smallest sourceFile/line).
  const a = r('user', 'fs-read', '/x', 'allow', { sourceFile: 'a.json', sourceLine: 1 })
  const b = r('user', 'fs-read', '/x', 'allow', { sourceFile: 'b.json', sourceLine: 2 })
  const fwd = resolveEffectiveRules({ user: [a, b] })
  const rev = resolveEffectiveRules({ user: [b, a] })
  assert.equal(fwd.length, 1)
  assert.equal(JSON.stringify(fwd), JSON.stringify(rev)) // byte-identical regardless of order
  assert.equal(fwd[0].metadata.sourceFile, 'a.json') // deterministic: the sort-first
  // provenance from resolveResourceDecision is likewise order-independent on a
  // raw (un-deduped) list with metadata-only differences.
  const pf = resolveResourceDecision({ resource: 'fs-read', target: '/x', rules: [a, b] }).rule.metadata.sourceFile
  const pr = resolveResourceDecision({ resource: 'fs-read', target: '/x', rules: [b, a] }).rule.metadata.sourceFile
  assert.equal(pf, pr)
})

test('C8b dedupe is deterministic for ANY metadata-only difference + net-host case', () => {
  // a difference in a NON-sort-key metadata field (reason, expiresAt) must still
  // dedupe to a deterministic survivor — the total order serializes ALL metadata.
  for (const [m1, m2] of [
    [{ reason: 'A' }, { reason: 'B' }],
    [{ expiresAt: 9e15 }, { expiresAt: 8e15 }],
  ]) {
    const a = r('org', 'fs-read', '/y', 'deny', m1)
    const b = r('org', 'fs-read', '/y', 'deny', m2)
    assert.equal(resolveEffectiveRules({ org: [a, b] }).length, 1)
    assert.equal(
      JSON.stringify(resolveEffectiveRules({ org: [a, b] })),
      JSON.stringify(resolveEffectiveRules({ org: [b, a] })),
    )
  }
  // net-host canonical (case-folded) duplicates dedupe to one even when a same-
  // specificity host sorts "between" them by raw codepoint — Map-keyed dedupe, not
  // sort adjacency.
  const eff = resolveEffectiveRules({
    user: [
      r('user', 'net-host', 'API.com', 'deny'),
      r('user', 'net-host', 'BPI.com', 'deny'),
      r('user', 'net-host', 'api.com', 'deny'),
    ],
  })
  assert.equal(eff.length, 2) // API.com==api.com canonical → 1, BPI.com → 1
  // and order-independent
  assert.equal(
    JSON.stringify(resolveEffectiveRules({ user: [r('user', 'net-host', 'API.com', 'deny'), r('user', 'net-host', 'api.com', 'deny')] })),
    JSON.stringify(resolveEffectiveRules({ user: [r('user', 'net-host', 'api.com', 'deny'), r('user', 'net-host', 'API.com', 'deny')] })),
  )
})

test('C8c 100 shuffles of a mixed ruleset → byte-identical output (true total order)', () => {
  const base = [
    r('user', 'fs-read', '/a', 'allow', { reason: 'x' }),
    r('user', 'fs-read', '/a', 'allow', { reason: 'y' }), // canonical dup, reason-only diff
    r('org', 'net-host', 'X.com', 'deny'),
    r('org', 'net-host', 'x.com', 'deny'), // canonical dup, case-only
    r('agent', 'fs-write', '/b/**', 'ask'),
    r('builtin-default', 'process-exec', 'git:*', 'deny'),
  ]
  const ref = JSON.stringify(resolveEffectiveRules(base))
  for (let i = 0; i < 100; i++) {
    const shuffled = [...base].sort(() => Math.random() - 0.5)
    assert.equal(JSON.stringify(resolveEffectiveRules(shuffled)), ref)
  }
})

// ── D. resolveResourceDecision: the security matrix ─────────────────────────

const dec = (resource, target, rules, opts = {}) => resolveResourceDecision({ resource, target, rules, ...opts })

test('D1 no rule matches → ask (or the configured default)', () => {
  assert.deepEqual(dec('fs-read', '/x', []), { decision: 'ask', rule: null, reason: 'no-match:ask' })
  assert.deepEqual(dec('fs-read', '/x', [], { defaultDecision: 'deny' }), {
    decision: 'deny',
    rule: null,
    reason: 'no-match:deny',
  })
  // an out-of-range defaultDecision coerces to 'ask'
  assert.equal(dec('fs-read', '/x', [], { defaultDecision: 'allow' }).decision, 'ask')
})

test('D2/D3/D4 a single matching allow / deny / ask', () => {
  assert.equal(dec('fs-read', '/a', [r('user', 'fs-read', '/a', 'allow')]).reason, 'allow:plain')
  assert.equal(dec('fs-read', '/a', [r('org', 'fs-read', '/a', 'deny')]).reason, 'deny:absolute')
  assert.equal(dec('fs-read', '/a', [r('org', 'fs-read', '/a', 'ask')]).reason, 'ask:rule')
})

test('D5 DENY IS ABSOLUTE: even a strictly-higher-layer equal allow does NOT override a deny', () => {
  // the escape hatch is deferred — a user allow cannot punch through an org deny.
  const got = dec('fs-read', '/secrets/x', [
    r('org', 'fs-read', '/secrets/**', 'deny'),
    r('user', 'fs-read', '/secrets/**', 'allow'),
  ])
  assert.equal(got.decision, 'deny')
  assert.equal(got.reason, 'deny:absolute')
})

test('D6 a BROAD high-layer allow can NOT override a PRECISE low-layer deny', () => {
  const got = dec('fs-read', '/secrets/master.key', [
    r('builtin-default', 'fs-read', '/secrets/master.key', 'deny'),
    r('user', 'fs-read', '/secrets/**', 'allow'), // higher layer, broader — irrelevant
  ])
  assert.equal(got.decision, 'deny') // deny is absolute
})

test('D7 an allow never overrides a deny, regardless of relative layer', () => {
  // a lower-layer allow vs a higher-layer deny → deny
  assert.equal(dec('fs-read', '/x', [r('agent', 'fs-read', '/x', 'allow'), r('user', 'fs-read', '/x', 'deny')]).decision, 'deny')
  // a higher-layer allow vs a lower-layer deny → STILL deny (absolute)
  assert.equal(dec('fs-read', '/x', [r('user', 'fs-read', '/x', 'allow'), r('builtin-default', 'fs-read', '/x', 'deny')]).decision, 'deny')
  // same layer → deny wins
  assert.equal(dec('fs-read', '/x', [r('user', 'fs-read', '/x', 'allow'), r('user', 'fs-read', '/x', 'deny')]).decision, 'deny')
})

test('D8 ANY matching deny blocks (multiple denies + an allow → still deny)', () => {
  const got = dec('fs-read', '/a/b', [
    r('org', 'fs-read', '/a/**', 'deny'),
    r('user', 'fs-read', '/a/b', 'deny'),
    r('user', 'fs-read', '/a/**', 'allow'), // highest layer allow — still cannot un-deny
  ])
  assert.equal(got.decision, 'deny')
})

test('D9 net-host parity with networkDecision: subdomain deny blocks, base falls through', () => {
  assert.equal(dec('net-host', 'x.evil.com', [r('org', 'net-host', '*.evil.com', 'deny')]).decision, 'deny')
  assert.equal(dec('net-host', 'evil.com', [r('org', 'net-host', '*.evil.com', 'deny')]).decision, 'ask') // base not matched → no-match
})

test('D10 order-independence: shuffled candidates → identical decision', () => {
  const rules = [
    r('builtin-default', 'fs-read', '/s/master.key', 'deny'),
    r('user', 'fs-read', '/s/**', 'allow'),
    r('org', 'fs-read', '/s/**', 'deny'),
  ]
  const a = dec('fs-read', '/s/master.key', rules).decision
  const b = dec('fs-read', '/s/master.key', [...rules].reverse()).decision
  assert.equal(a, b)
  assert.equal(a, 'deny') // a matching deny is present → deny, regardless of order
})

test('D11 expired deny does not block (now past); blocks if now omitted/before', () => {
  const denyRule = [r('org', 'fs-read', '/a', 'deny', { expiresAt: 500 })]
  assert.equal(dec('fs-read', '/a', denyRule, { now: NOW }).decision, 'ask') // expired → no candidate
  assert.equal(dec('fs-read', '/a', denyRule).decision, 'deny') // now omitted → blocks
  assert.equal(dec('fs-read', '/a', denyRule, { now: 400 }).decision, 'deny') // before expiry
})

test('D12 a malformed-pattern rule contributes NO candidate (neither allow nor deny)', () => {
  assert.equal(dec('fs-read', '/x', [r('user', 'fs-read', '', 'deny')]).decision, 'ask') // empty pattern dropped
  assert.equal(dec('fs-read', '/x', [r('user', 'fs-read', '/y', 'allow')]).decision, 'ask') // non-matching
})

test('D13 never throws on garbage args; resolveResourceAction returns just the verb', () => {
  assert.equal(resolveResourceDecision().decision, 'ask')
  assert.equal(resolveResourceDecision({}).decision, 'ask')
  assert.equal(resolveResourceDecision({ resource: 'fs-read', target: '/x', rules: 'not-an-array' }).decision, 'ask')
  assert.equal(resolveResourceAction({ resource: 'fs-read', target: '/a', rules: [r('user', 'fs-read', '/a', 'deny')] }), 'deny')
})

// ── E. buildCacheFriendlyConfigSummary: the cache moat ──────────────────────

test('E1 static starts with the schema tag + lists decision-relevant fields in order', () => {
  const eff = resolveEffectiveRules({ user: [r('user', 'fs-read', '/a', 'allow')], org: [r('org', 'fs-write', '/b', 'deny')] })
  const { static: s } = buildCacheFriendlyConfigSummary(eff)
  assert.ok(s.startsWith('rsv1\n'))
  assert.match(s, /fs-read\|user\|allow\|\/a/)
  assert.match(s, /fs-write\|org\|deny\|\/b/)
})

test('E2 MOAT INVARIANT: static is identical across different `now`; dynamic differs', () => {
  const eff = resolveEffectiveRules({ org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: NOW + 5_000_000 })] })
  const s1 = buildCacheFriendlyConfigSummary(eff, { now: NOW })
  const s2 = buildCacheFriendlyConfigSummary(eff, { now: NOW + 10_000_000 })
  assert.equal(s1.static, s2.static) // the cache-moat guard
  assert.notEqual(s1.dynamic, s2.dynamic) // telemetry may move
})

test('E3 static EXCLUDES every volatile field', () => {
  const eff = resolveEffectiveRules({
    org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: 123456789, reason: 'secret', sourceFile: 'x.json', sourceLine: 9 })],
  })
  const { static: s } = buildCacheFriendlyConfigSummary(eff, { now: NOW })
  assert.doesNotMatch(s, /expiresAt|reason|sourceFile|sourceLine|generatedAt|totalRules/)
  assert.doesNotMatch(s, /123456789/) // no epoch digits leak in
})

test('E4 empty ruleset → static === "rsv1", dynamic is well-formed JSON with totalRules:0', () => {
  const { static: s, dynamic: d } = buildCacheFriendlyConfigSummary([])
  assert.equal(s, 'rsv1')
  assert.deepEqual(JSON.parse(d), { generatedAt: null, totalRules: 0, byResource: {}, byLayer: {}, soonestExpiry: null })
})

test('E5 dynamic is valid JSON with the expected shape', () => {
  const eff = resolveEffectiveRules({ org: [r('org', 'fs-read', '/a', 'deny', { expiresAt: NOW + 100 })] })
  const parsed = JSON.parse(buildCacheFriendlyConfigSummary(eff, { now: NOW }).dynamic)
  assert.equal(parsed.totalRules, 1)
  assert.deepEqual(parsed.byResource, { 'fs-read': 1 })
  assert.deepEqual(parsed.byLayer, { org: 1 })
  assert.equal(parsed.soonestExpiry, NOW + 100)
  assert.equal(parsed.generatedAt, NOW)
})

// ── F. exported constants are the single source of truth ────────────────────

test('F LAYER_RANK / ACTION_RANK shapes match the spec (manager.ts shares these)', () => {
  assert.deepEqual(LAYER_RANK, { 'builtin-default': 0, org: 1, agent: 2, user: 3 })
  assert.deepEqual(ACTION_RANK, { deny: 0, allow: 1, ask: 2 })
  // parsePattern: ok + metric fields for a valid pattern; ok:false for bad input.
  const p = parsePattern('fs-read', '/a/**')
  assert.equal(p.ok, true)
  assert.equal(typeof p.literalCount, 'number')
  assert.equal(parsePattern('fs-read', '').ok, false)
  assert.equal(parsePattern('bogus', '/x').ok, false)
})

// ── G. adversarial-review regressions (security-critical; do NOT relax) ──────

test('G1 DENY IS ABSOLUTE: NO allow (broad or precise, any layer) overrides a matching deny', () => {
  // The whole class of escape-hatch fail-opens is closed by making deny absolute:
  // a higher-layer allow — broad OR precise — can never punch through a deny.
  const allowVariants = [
    '/etc/shadow', '/etc/shadow*', '/etc/shadow**', '/etc/shadow?', // broad/exact over a precise deny
    '/**', '/etc/**', // the "allow everything"/"allow subtree" footguns that nuked denies
  ]
  for (const allowPat of allowVariants) {
    const got = dec('fs-read', '/etc/shadow', [
      r('builtin-default', 'fs-read', '/etc/shadow', 'deny'),
      r('user', 'fs-read', allowPat, 'allow'),
    ])
    assert.equal(got.decision, 'deny', `user allow ${allowPat} must NOT override a builtin deny`)
  }
  // a broad `allow /**` does not nuke a more-specific deny (the coverage-fuzz footgun)
  assert.equal(
    dec('fs-read', '/x/z/sec/a', [
      r('builtin-default', 'fs-read', '/**/**/a/**', 'deny'),
      r('user', 'fs-read', '/**', 'allow'),
    ]).decision,
    'deny',
  )
})

test('G2 TRUST-ELEVATION closed: a rule self-declaring a higher layer is overridden by its bucket', () => {
  // a low-trust bucket rule that lies about its layer must NOT be elevated.
  assert.equal(resolveEffectiveRules({ 'builtin-default': [r('user', 'fs-read', '/x', 'allow')] })[0].layer, 'builtin-default')
  assert.equal(resolveEffectiveRules([{ layer: 'org', rules: [r('user', 'fs-read', '/x', 'allow')] }])[0].layer, 'org')
  // and so it can NOT escape-hatch a genuine org deny by faking 'user'
  const got = dec('fs-read', '/x', [
    ...resolveEffectiveRules({ org: [r('org', 'fs-read', '/x', 'deny')], 'builtin-default': [r('user', 'fs-read', '/x', 'allow')] }),
  ])
  assert.equal(got.decision, 'deny')
})

test('G3 ReDoS closed: a deeply-nested `**` pattern resolves in linear time', () => {
  const pat = '/' + '**/'.repeat(40) + 'x'
  const tgt = '/' + 'a/'.repeat(3000) + 'b'
  const start = process.hrtime.bigint()
  const m = patternMatches('fs-read', pat, tgt)
  const ms = Number(process.hrtime.bigint() - start) / 1e6
  assert.equal(m, false)
  assert.ok(ms < 250, `40×** match took ${ms}ms — must be sub-linear (no catastrophic backtracking)`)
})

test('G4 fail-safe: resolveResourceDecision never throws on null / non-object args', () => {
  assert.equal(resolveResourceDecision(null).decision, 'ask')
  assert.equal(resolveResourceDecision('garbage').decision, 'ask')
  assert.equal(resolveResourceDecision(42).decision, 'ask')
})

test('G5 `/**` does not over-match the empty target', () => {
  assert.equal(patternMatches('fs-read', '/**', ''), false)
  assert.equal(patternMatches('fs-read', '**', ''), false)
})

// ── H: case-folded fs path matching for DENY rules (audit HIGH fix) ──────────
// A fs-read/fs-write DENY must not be bypassable by a differently-cased path resolving to
// the same on-disk file (e.g. ~/.SSH vs ~/.ssh). patternMatches folds when its foldCase
// arg is set; resolveResourceDecision passes foldCase=true for DENY rules on EVERY
// platform (folding is over-block-safe + needs no platform detection, mirroring the
// codebase's always-on normalizeCaseForComparison). ALLOW/ASK are NOT folded — folding an
// allow would over-GRANT a distinct file on a case-sensitive volume (a fail-open).

test('H1 patternMatches folds fs-read/fs-write case when foldCase is set', () => {
  // foldCase off: a differently-cased path does NOT match
  assert.equal(patternMatches('fs-write', '/Users/me/.ssh/**', '/Users/me/.SSH/k'), false)
  assert.equal(patternMatches('fs-read', '/etc/Secret', '/etc/secret'), false)
  // foldCase on: it matches (same on-disk file on a case-insensitive FS)
  assert.equal(patternMatches('fs-write', '/Users/me/.ssh/**', '/Users/me/.SSH/k', true), true)
  assert.equal(patternMatches('fs-read', '/etc/Secret', '/etc/secret', true), true)
  assert.equal(patternMatches('fs-read', '/USERS/me/.ssh/id', '/Users/me/.ssh/id', true), true)
})

test('H2 process-exec (binary name) and net-host are NOT case-folded by foldCase', () => {
  // process-exec is a binary NAME — case-sensitive even when foldCase is on
  assert.equal(patternMatches('process-exec', 'RM', 'rm', true), false)
  assert.equal(patternMatches('process-exec', 'rm', 'rm', true), true)
  // net-host already folds domains regardless of foldCase
  assert.equal(patternMatches('net-host', 'Evil.COM', 'evil.com'), true)
})

test('H3 a DENY fs rule matches case-insensitively (not case-bypassable) on every platform', () => {
  const rules = [{ layer: 'user', resource: 'fs-write', action: 'deny', pattern: '/Users/me/.ssh/**' }]
  const at = target => resolveResourceDecision({ resource: 'fs-write', target, rules, defaultDecision: 'ask' }).decision
  // a differently-cased path resolving to the same file is still denied — no platform flag
  assert.equal(at('/Users/me/.SSH/authorized_keys'), 'deny')
  assert.equal(at('/Users/me/.ssh/authorized_keys'), 'deny')
  assert.equal(at('/USERS/me/.ssh/authorized_keys'), 'deny')
  // an unrelated path is unaffected
  assert.equal(at('/Users/me/projects/x'), 'ask')
})

test('H4 an ALLOW rule is NOT case-folded — no over-grant on a case-sensitive volume', () => {
  // Folding an allow would OVER-GRANT a genuinely case-distinct file on a case-SENSITIVE
  // volume (a fail-open). So allow stays case-sensitive: only the exact case is allowed;
  // a differently-cased access falls through to the default (here 'deny'), never granted.
  const rules = [{ layer: 'user', resource: 'fs-read', action: 'allow', pattern: '/x/Secret' }]
  const at = target => resolveResourceDecision({ resource: 'fs-read', target, rules, defaultDecision: 'deny' }).decision
  assert.equal(at('/x/Secret'), 'allow') // exact case → allowed
  assert.equal(at('/x/secret'), 'deny') // differently-cased → NOT over-granted (floored)
})
