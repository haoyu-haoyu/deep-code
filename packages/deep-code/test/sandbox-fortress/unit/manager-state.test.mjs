import test from 'node:test'
import assert from 'node:assert/strict'

import { createFortressManagerState } from '../../../src/sandbox-fortress/rule-engine/managerState.mjs'

// ── F3 wiring PR-A: the pure manager-state factory (composes the 3 cores) ─────
// This is the node-testable logic behind FortressSandboxManager's 12 methods.
// Standalone — nothing in src/ imports it yet, so dist stays byte-identical.
// The factory is the SINGLE place the clock enters the rule path; tests freeze it.

const FROZEN = 1_700_000_000_000
const frozen = () => FROZEN

// ── A. empty-state: every method is a provable no-op (byte-identical default) ──

test('A1 empty state: resolution/effort/summary/dry-run/feedback/profile are all benign', () => {
  const s = createFortressManagerState({ now: frozen })
  assert.deepEqual(s.resolveEffectiveRules(), [])
  // effort 'off' → lenient → 'ask' (DEFERS to host permission flow; never a deny)
  assert.equal(s.getCurrentEffort(), 'off')
  assert.equal(s.getDefaultDecision(), 'ask')
  // an un-ruled access defers (ask), never a spurious deny
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/anything' }).decision, 'ask')
  assert.equal(s.isDryRunMode(), false)
  assert.equal(s.buildViolationFeedback(), null)
  // summary: static is the timestamp-free constant; dynamic reports zero rules
  const summary = s.buildCacheFriendlyConfigSummary()
  assert.equal(summary.static, 'rsv1')
  assert.equal(JSON.parse(summary.dynamic).totalRules, 0)
  // a tool with no stored profile → the non-null default
  assert.deepEqual(s.getProfileForTool('Bash'), {
    toolName: 'Bash',
    fileSystemMode: 'workspace-write',
    networkMode: 'allow',
  })
})

test('A2 the static summary is timestamp-free (cache-prefix safe) while dynamic carries the clock', () => {
  const s = createFortressManagerState({ now: frozen })
  const other = createFortressManagerState({ now: () => FROZEN + 999 })
  // SAME static digest regardless of clock (the cache-prefix invariant)...
  assert.equal(s.buildCacheFriendlyConfigSummary().static, other.buildCacheFriendlyConfigSummary().static)
  // ...but the dynamic block reflects the clock (telemetry, never in the prefix)
  assert.equal(JSON.parse(s.buildCacheFriendlyConfigSummary().dynamic).generatedAt, FROZEN)
})

// ── B. rulesets: storage, defensive copies, layer validation ──────────────────

test('B1 setRuleset/getRulesetByLayer round-trip; both directions are defensively copied', () => {
  const s = createFortressManagerState({ now: frozen })
  const input = [{ layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny' }]
  s.setRuleset('org', input)
  // mutating the INPUT array/objects after set must not change stored state
  input.push({ layer: 'org', resource: 'fs-read', pattern: '/injected', action: 'allow' })
  input[0].action = 'allow'
  const got = s.getRulesetByLayer('org')
  assert.equal(got.rules.length, 1)
  assert.equal(got.rules[0].action, 'deny')
  // mutating the RETURNED array must not change stored state either
  got.rules.push({ tampered: true })
  assert.equal(s.getRulesetByLayer('org').rules.length, 1)
})

test('B2 an invalid layer is ignored (the bucket stays authoritative)', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('bogus-layer', [{ layer: 'user', resource: 'fs-read', pattern: '/x', action: 'allow' }])
  assert.deepEqual(s.getRulesetByLayer('bogus-layer'), { layer: 'bogus-layer', rules: [] })
  // and it does NOT leak into the effective ruleset via the rule's self-declared layer
  assert.deepEqual(s.resolveEffectiveRules(), [])
})

test('B3 a non-array ruleset stores empty; an unset layer reads empty', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('user', 'not-an-array')
  assert.deepEqual(s.getRulesetByLayer('user'), { layer: 'user', rules: [] })
  assert.deepEqual(s.getRulesetByLayer('agent'), { layer: 'agent', rules: [] })
})

// ── C. resolution: deny-first absolute + frozen-clock expiry filtering ─────────

test('C1 resolveDecision is deny-first absolute and honors the effort no-match default', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('org', [{ layer: 'org', resource: 'fs-read', pattern: '/secret/**', action: 'deny' }])
  // a matching deny is enforced regardless of effort
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret/key' }).decision, 'deny')
  // an un-ruled access at effort 'off' defers to ask...
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/elsewhere' }).decision, 'ask')
  // ...and at effort 'max' (paranoid) it fails closed to deny — without weakening the explicit deny
  s.setEffortLevel('max')
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/elsewhere' }).decision, 'deny')
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret/key' }).decision, 'deny')
})

test('C2 expiry filtering is enabled by the injected clock (past → dropped, future → kept)', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('org', [
    { layer: 'org', resource: 'fs-read', pattern: '/expired', action: 'deny', metadata: { expiresAt: FROZEN - 1 } },
    { layer: 'org', resource: 'fs-read', pattern: '/live', action: 'deny', metadata: { expiresAt: FROZEN + 1 } },
  ])
  const effective = s.resolveEffectiveRules()
  assert.equal(effective.length, 1)
  assert.equal(effective[0].pattern, '/live')
  // the expired deny no longer blocks; the live deny still does
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/expired' }).decision, 'ask')
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/live' }).decision, 'deny')
})

test('C3 resolution reflects the LATEST state (setRuleset/effort changes take effect)', () => {
  const s = createFortressManagerState({ now: frozen })
  assert.equal(s.resolveEffectiveRules().length, 0)
  s.setRuleset('user', [{ layer: 'user', resource: 'fs-write', pattern: '/etc/**', action: 'deny' }])
  assert.equal(s.resolveEffectiveRules().length, 1)
  s.setRuleset('user', [])
  assert.equal(s.resolveEffectiveRules().length, 0)
})

// ── D. effort / strictness wiring ─────────────────────────────────────────────

test('D1 setEffortLevel/getCurrentEffort/getDefaultDecision track the effort controller', () => {
  const s = createFortressManagerState({ now: frozen })
  const cases = [
    ['off', 'ask'],
    ['high', 'ask'],
    ['max', 'deny'],
  ]
  for (const [effort, decision] of cases) {
    s.setEffortLevel(effort)
    assert.equal(s.getCurrentEffort(), effort)
    assert.equal(s.getDefaultDecision(), decision)
  }
  // an invalid effort is ignored (keeps the prior valid one)
  s.setEffortLevel('bogus')
  assert.equal(s.getCurrentEffort(), 'max')
})

test('D2 setStrictnessByEffort remaps effort→strictness→default decision', () => {
  const s = createFortressManagerState({ now: frozen })
  // make even effort 'off' fail closed
  s.setStrictnessByEffort({ off: 'paranoid', high: 'paranoid', max: 'paranoid' })
  assert.equal(s.getCurrentEffort(), 'off')
  assert.equal(s.getDefaultDecision(), 'deny')
})

// ── E. dry-run + violations (the async DB + the sync mirror) ───────────────────

test('E1 enableDryRunMode toggles isDryRunMode and annotates the feedback header', async () => {
  const s = createFortressManagerState({ now: frozen })
  assert.equal(s.isDryRunMode(), false)
  s.enableDryRunMode(true)
  assert.equal(s.isDryRunMode(), true)
  s.recordFortressViolation({ toolName: 'Bash', event: { line: 'blocked rm -rf /' } })
  const fb = s.buildViolationFeedback()
  assert.match(fb, /1 violation recorded/)
  assert.match(fb, /dry-run: logged, not enforced/)
  assert.match(fb, /blocked rm -rf \//)
  // only `=== true` enables dry-run (fail-safe)
  s.enableDryRunMode('yes')
  assert.equal(s.isDryRunMode(), false)
})

test('E2 recordFortressViolation feeds BOTH the sync mirror and the async DB', async () => {
  const s = createFortressManagerState({ now: frozen })
  s.recordFortressViolation({ toolName: 'Read', event: { line: 'denied /secret' } })
  // sync mirror → buildViolationFeedback (no await)
  assert.match(s.buildViolationFeedback(), /denied \/secret/)
  // async canonical DB → listViolations (awaited)
  const db = s.getViolationDb()
  const stored = await db.listViolations()
  assert.equal(stored.length, 1)
  assert.equal(stored[0].toolName, 'Read')
})

test('E3 the sync mirror is bounded by maxViolations (oldest dropped)', () => {
  const s = createFortressManagerState({ now: frozen, maxViolations: 3 })
  for (let i = 0; i < 5; i++) s.recordFortressViolation({ toolName: 'Bash', event: { line: `v${i}` } })
  const fb = s.buildViolationFeedback()
  // only the last 3 survive in the mirror; v0/v1 dropped
  assert.match(fb, /3 violations recorded/)
  assert.doesNotMatch(fb, /v0|v1/)
  assert.match(fb, /v4/)
})

test('E4 a non-object violation record is ignored (never throws, never mirrored)', () => {
  const s = createFortressManagerState({ now: frozen })
  assert.doesNotThrow(() => {
    s.recordFortressViolation(null)
    s.recordFortressViolation('nope')
    s.recordFortressViolation(42)
  })
  assert.equal(s.buildViolationFeedback(), null)
})

test('E5 the sync mirror is defensively copied — mutating the input record cannot tamper feedback', () => {
  const s = createFortressManagerState({ now: frozen })
  const rec = { toolName: 'Bash', event: { line: 'original' } }
  s.recordFortressViolation(rec)
  rec.toolName = 'TAMPERED' // top-level mutation after record
  assert.doesNotMatch(s.buildViolationFeedback(), /TAMPERED/)
})

// ── F. per-tool profiles (advisory; defensively copied) ───────────────────────

test('F1 setProfileForTool/getProfileForTool round-trip with defensive copies', () => {
  const s = createFortressManagerState({ now: frozen })
  const p = { toolName: 'WebFetch', fileSystemMode: 'read-only', networkMode: 'deny', additionalDenyPatterns: ['/x'] }
  s.setProfileForTool('WebFetch', p)
  p.fileSystemMode = 'workspace-write' // mutate input after set
  p.additionalDenyPatterns.push('/y') // mutate nested array after set
  assert.equal(s.getProfileForTool('WebFetch').fileSystemMode, 'read-only')
  assert.deepEqual(s.getProfileForTool('WebFetch').additionalDenyPatterns, ['/x'])
  // mutate the returned profile → internal unchanged
  const got = s.getProfileForTool('WebFetch')
  got.networkMode = 'allow'
  got.additionalDenyPatterns.push('/z')
  assert.equal(s.getProfileForTool('WebFetch').networkMode, 'deny')
  assert.deepEqual(s.getProfileForTool('WebFetch').additionalDenyPatterns, ['/x'])
})

test('F2 setProfileForTool NORMALIZES malformed input → getProfileForTool always returns a valid profile', () => {
  const s = createFortressManagerState({ now: frozen })
  // a junk object: unknown keys dropped, invalid modes → defaults, toolName from the key
  s.setProfileForTool('Bash', { junk: 1, fileSystemMode: 'bogus', networkMode: 42, toolName: 'SPOOFED' })
  assert.deepEqual(s.getProfileForTool('Bash'), { toolName: 'Bash', fileSystemMode: 'workspace-write', networkMode: 'allow' })
  // an array profile → fully defaulted (never a stored array)
  s.setProfileForTool('Read', [1, 2, 3])
  assert.deepEqual(s.getProfileForTool('Read'), { toolName: 'Read', fileSystemMode: 'workspace-write', networkMode: 'allow' })
  // valid modes + valid pattern arrays are preserved; non-string entries filtered
  s.setProfileForTool('Edit', { fileSystemMode: 'no-fs', networkMode: 'allow-with-restrictions', additionalAllowPatterns: ['/ok', 5, null, '/ok2'] })
  assert.deepEqual(s.getProfileForTool('Edit'), {
    toolName: 'Edit',
    fileSystemMode: 'no-fs',
    networkMode: 'allow-with-restrictions',
    additionalAllowPatterns: ['/ok', '/ok2'],
  })
})

// ── G. robustness: never throws on garbage; clock default ─────────────────────

test('G1 the factory tolerates garbage options and a missing clock', () => {
  assert.doesNotThrow(() => {
    createFortressManagerState()
    createFortressManagerState(null)
    createFortressManagerState(42)
    createFortressManagerState({ now: 'not-a-fn', maxViolations: -5 })
  })
  // a non-function now falls back to Date.now() — resolution still works
  const s = createFortressManagerState({ now: 'nope' })
  assert.deepEqual(s.resolveEffectiveRules(), [])
  assert.equal(typeof s.buildCacheFriendlyConfigSummary().static, 'string')
})

test('G2 the factory survives a Proxy options bag whose traps throw', () => {
  const hostile = new Proxy({}, { get() { throw new Error('boom') }, has() { throw new Error('boom') } })
  let s
  assert.doesNotThrow(() => {
    s = createFortressManagerState(hostile)
  })
  // falls back to a real clock + default bound; still functional
  assert.deepEqual(s.resolveEffectiveRules(), [])
})

test('G3 a THROWING now thunk falls back to the real clock (never crashes a method)', () => {
  const s = createFortressManagerState({
    now: () => {
      throw new Error('hostile clock')
    },
  })
  assert.doesNotThrow(() => {
    s.resolveEffectiveRules()
    s.resolveDecision({ resource: 'fs-read', target: '/x' })
    s.buildCacheFriendlyConfigSummary()
  })
  // a non-finite clock return also falls back (NaN/Infinity must not poison expiry)
  const s2 = createFortressManagerState({ now: () => Number.NaN })
  assert.doesNotThrow(() => s2.resolveEffectiveRules())
})

test('G4 resolveDecision is null-safe (a non-object arg defers, never throws)', () => {
  const s = createFortressManagerState({ now: frozen })
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.doesNotThrow(() => s.resolveDecision(bad))
    // un-ruled / unparseable target at effort 'off' → ask (defers), never a throw
    assert.equal(s.resolveDecision(bad).decision, 'ask')
  }
})

test('G5 resolveDecision survives a throwing getter on the args (fail-safe to the effort default)', () => {
  const s = createFortressManagerState({ now: frozen })
  const hostile = {
    get resource() {
      throw new Error('boom')
    },
    target: '/x',
  }
  // at effort 'off' the fail-safe default is ask (never a crash, never weaker)
  assert.doesNotThrow(() => s.resolveDecision(hostile))
  assert.equal(s.resolveDecision(hostile).decision, 'ask')
  // at effort 'max' the fail-safe default is deny (never weaker than the policy)
  s.setEffortLevel('max')
  assert.equal(s.resolveDecision(hostile).decision, 'deny')
})

test('G7 setRuleset survives a hostile array (throwing map/index traps) — stores empty, no crash', () => {
  const s = createFortressManagerState({ now: frozen })
  const hostile = new Proxy([{ layer: 'org', resource: 'fs-read', pattern: '/x', action: 'deny' }], {
    get(t, k) {
      if (k === 'map') throw new Error('boom')
      return Reflect.get(t, k)
    },
  })
  assert.doesNotThrow(() => s.setRuleset('org', hostile))
  assert.deepEqual(s.getRulesetByLayer('org').rules, [])
})

test('G8 SECURITY: a polluted Object.prototype cannot inject factory options (own-key reads only)', () => {
  const savedMax = Object.prototype.maxViolations
  const savedNow = Object.prototype.now
  try {
    Object.prototype.maxViolations = 1 // would shrink the mirror bound if trusted
    Object.prototype.now = () => 0 // would hijack the clock if trusted
    const s = createFortressManagerState({})
    for (let i = 0; i < 3; i++) s.recordFortressViolation({ toolName: 'B', event: { line: `v${i}` } })
    // the inherited maxViolations=1 must NOT be honored → all 3 survive
    assert.match(s.buildViolationFeedback(), /3 violations recorded/)
  } finally {
    if (savedMax === undefined) delete Object.prototype.maxViolations
    else Object.prototype.maxViolations = savedMax
    if (savedNow === undefined) delete Object.prototype.now
    else Object.prototype.now = savedNow
  }
})

test('G8b a hostile Array.isArray-true input cannot crash ANY deepCopy caller (never-throws)', () => {
  const s = createFortressManagerState({ now: frozen })
  // a Proxy that IS an array but throws on the `length` read
  const hostile = new Proxy([], {
    get(t, k) {
      if (k === 'length') throw new Error('boom')
      return Reflect.get(t, k)
    },
  })
  assert.doesNotThrow(() => s.recordFortressViolation(hostile))
  assert.doesNotThrow(() => s.setProfileForTool('X', hostile))
  assert.doesNotThrow(() => s.setRuleset('org', [hostile]))
  assert.doesNotThrow(() => s.setRuleset('org', hostile))
})

test('G8c setRuleset/record/profile survive a REVOKED proxy (Array.isArray itself throws)', () => {
  const s = createFortressManagerState({ now: frozen })
  const mk = () => {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()
    return proxy
  }
  assert.doesNotThrow(() => s.setRuleset('org', mk()))
  assert.deepEqual(s.getRulesetByLayer('org').rules, [])
  assert.doesNotThrow(() => s.setRuleset('org', [mk()]))
  assert.doesNotThrow(() => s.recordFortressViolation(mk()))
  assert.doesNotThrow(() => s.setProfileForTool('X', mk()))
})

test('G8d a malformed record cannot evict real violations from the bounded sync mirror', () => {
  const s = createFortressManagerState({ now: frozen, maxViolations: 2 })
  s.recordFortressViolation({ toolName: 'real', event: { line: 'REAL-VIOLATION' } })
  // flood with malformed records whose deepCopy collapses to undefined
  for (let i = 0; i < 5; i++) {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()
    s.recordFortressViolation(proxy)
  }
  // the real violation must still be reported (malformed records took no slots)
  assert.match(s.buildViolationFeedback(), /REAL-VIOLATION/)
})

test('G9 a function rule entry is dropped (no reference leak), not stored by reference', () => {
  const s = createFortressManagerState({ now: frozen })
  const fn = () => {}
  fn.layer = 'org'
  fn.resource = 'fs-read'
  fn.action = 'deny'
  fn.pattern = '/x'
  s.setRuleset('org', [fn])
  const stored = s.getRulesetByLayer('org').rules
  assert.notEqual(stored[0], fn) // not the original reference
  // a function isn't a valid rule → it never enters the effective set either
  assert.deepEqual(s.resolveEffectiveRules(), [])
})

test('G6 a rule with a throwing getter is copied without throwing and cannot poison resolution', () => {
  const s = createFortressManagerState({ now: frozen })
  // a "rule" whose `pattern` getter throws: structuredClone + JSON both throw, so the
  // manual clone backstop runs (drops the throwing field), and nothing crashes.
  const hostileRule = {
    layer: 'org',
    resource: 'fs-read',
    action: 'deny',
    get pattern() {
      throw new Error('boom')
    },
  }
  assert.doesNotThrow(() => {
    s.setRuleset('org', [hostileRule])
    s.resolveEffectiveRules()
    s.resolveDecision({ resource: 'fs-read', target: '/x' })
    s.getRulesetByLayer('org')
  })
  // the stored copy shares no reference with the input and reads cleanly
  const stored = s.getRulesetByLayer('org').rules[0]
  assert.notEqual(stored, hostileRule)
  assert.doesNotThrow(() => JSON.stringify(stored)) // no throwing getter survived
})

// ── H. deep-copy isolation (the CRITICAL invariant: a mutation can't flip a deny) ─

test('H1 mutating a returned rule object cannot disable a stored DENY', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('user', [{ layer: 'user', resource: 'fs-read', pattern: '/etc/passwd', action: 'deny' }])
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/etc/passwd' }).decision, 'deny')
  // tamper the RETURNED rule (deep copy → no effect on stored state)
  const got = s.getRulesetByLayer('user')
  got.rules[0].action = 'allow'
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/etc/passwd' }).decision, 'deny')
})

test('H2 mutating the INPUT rule\'s nested metadata.expiresAt cannot flip a stored DENY', () => {
  const s = createFortressManagerState({ now: frozen })
  const input = [
    { layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny', metadata: { expiresAt: FROZEN + 10_000 } },
  ]
  s.setRuleset('org', input)
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret' }).decision, 'deny')
  // mutate the original nested metadata to "expire" the rule in the past
  input[0].metadata.expiresAt = FROZEN - 1
  // deep copy means the stored rule's expiry is unchanged → deny still enforced
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret' }).decision, 'deny')
})

test('H2b mutating resolveEffectiveRules() output cannot flip a stored DENY (no core-alias leak)', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('org', [
    { layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny', metadata: { expiresAt: FROZEN + 10_000 } },
  ])
  const out = s.resolveEffectiveRules()
  // tamper the returned rule's nested metadata + action (would alias the store w/o the out-copy)
  out[0].metadata.expiresAt = FROZEN - 1
  out[0].action = 'allow'
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret' }).decision, 'deny')
})

test('H2c mutating resolveDecision().rule cannot flip a stored DENY (no core-alias leak)', () => {
  const s = createFortressManagerState({ now: frozen })
  s.setRuleset('org', [
    { layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny', metadata: { expiresAt: FROZEN + 10_000 } },
  ])
  const d = s.resolveDecision({ resource: 'fs-read', target: '/secret' })
  assert.equal(d.decision, 'deny')
  if (d.rule && d.rule.metadata) d.rule.metadata.expiresAt = FROZEN - 1
  assert.equal(s.resolveDecision({ resource: 'fs-read', target: '/secret' }).decision, 'deny')
})

test('H3 a violation record\'s nested event mutation cannot rewrite model-facing feedback', () => {
  const s = createFortressManagerState({ now: frozen })
  const rec = { toolName: 'Bash', event: { line: 'BLOCKED rm -rf /' } }
  s.recordFortressViolation(rec)
  rec.event.line = 'nothing happened' // tamper the nested event after recording
  assert.match(s.buildViolationFeedback(), /BLOCKED rm -rf \//)
  assert.doesNotMatch(s.buildViolationFeedback(), /nothing happened/)
})

test('H4 a rejecting/throwing violation backend does not break recording (best-effort canonical write)', () => {
  const s = createFortressManagerState({ now: frozen })
  // simulate a hostile backend by swapping in a record path that rejects: we can't
  // replace the internal DB, so assert the in-memory path never throws and the mirror
  // still gets the record (the .catch guard covers a swapped persistent backend).
  assert.doesNotThrow(() => s.recordFortressViolation({ toolName: 'X', event: { line: 'e' } }))
  assert.match(s.buildViolationFeedback(), /1 violation recorded/)
})

test('I1 resolveDecision case-folds a DENY fs rule (no case-bypass) but not an ALLOW (no over-grant)', () => {
  // a fs DENY is matched case-insensitively → a differently-cased path is still denied
  const d = createFortressManagerState({ now: frozen })
  d.setRuleset('user', [{ layer: 'user', resource: 'fs-write', pattern: '/Users/me/.ssh/**', action: 'deny' }])
  assert.equal(d.resolveDecision({ resource: 'fs-write', target: '/Users/me/.SSH/k' }).decision, 'deny')
  assert.equal(d.resolveDecision({ resource: 'fs-write', target: '/Users/me/.ssh/k' }).decision, 'deny')
  // a fs ALLOW is matched case-SENSITIVELY → a differently-cased path is NOT over-granted
  // (falls through to the paranoid floor 'deny' at effort max)
  const a = createFortressManagerState({ now: frozen })
  a.setEffortLevel('max')
  a.setRuleset('user', [{ layer: 'user', resource: 'fs-read', pattern: '/x/Secret', action: 'allow' }])
  assert.equal(a.resolveDecision({ resource: 'fs-read', target: '/x/Secret' }).decision, 'allow')
  assert.equal(a.resolveDecision({ resource: 'fs-read', target: '/x/secret' }).decision, 'deny')
})
