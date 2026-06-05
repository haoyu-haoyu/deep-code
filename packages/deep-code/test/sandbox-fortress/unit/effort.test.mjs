import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_EFFORT_STRICTNESS,
  EFFORT_LEVELS,
  STRICTNESS_LEVELS,
  createEffortController,
  strictnessToDefaultDecision,
} from '../../../src/sandbox-fortress/rule-engine/effort.mjs'
import { resolveResourceDecision } from '../../../src/sandbox-fortress/rule-engine/resolveRules.mjs'

// ── F3 PR-3: effort → strictness → default-decision coupling (pure, NOT wired) ─
// Effort never weakens an explicit deny (the rule engine is deny-first absolute);
// it only decides what an UN-ruled access defaults to. Fail-safe: invalid input
// defaults conservatively, never disabling the fortress.

// ── A. constants + the strictness → default-decision bridge ──────────────────

test('A1 the level vocabularies match types.ts and are frozen', () => {
  assert.deepEqual([...EFFORT_LEVELS], ['off', 'high', 'max'])
  assert.deepEqual([...STRICTNESS_LEVELS], ['lenient', 'standard', 'paranoid'])
  assert.deepEqual(DEFAULT_EFFORT_STRICTNESS, { off: 'lenient', high: 'standard', max: 'paranoid' })
  assert.ok(Object.isFrozen(DEFAULT_EFFORT_STRICTNESS))
})

test('A2 strictnessToDefaultDecision: ONLY paranoid blocks; everything else (incl. garbage) defers', () => {
  assert.equal(strictnessToDefaultDecision('paranoid'), 'deny')
  assert.equal(strictnessToDefaultDecision('lenient'), 'ask')
  assert.equal(strictnessToDefaultDecision('standard'), 'ask')
  assert.equal(strictnessToDefaultDecision('bogus'), 'ask') // fail-safe (never throws)
  assert.equal(strictnessToDefaultDecision(undefined), 'ask')
})

// ── B. the controller: effort → strictness → default decision ────────────────

test('B1 default controller: off → lenient → ask', () => {
  const c = createEffortController()
  assert.equal(c.getEffort(), 'off')
  assert.equal(c.getStrictness(), 'lenient')
  assert.equal(c.getDefaultDecision(), 'ask')
})

test('B2 each default effort maps to its strictness + decision', () => {
  const cases = [
    ['off', 'lenient', 'ask'],
    ['high', 'standard', 'ask'],
    ['max', 'paranoid', 'deny'],
  ]
  for (const [effort, strictness, decision] of cases) {
    const c = createEffortController({ effort })
    assert.equal(c.getStrictness(), strictness, `${effort} → ${strictness}`)
    assert.equal(c.getDefaultDecision(), decision, `${effort} → ${decision}`)
  }
})

test('B3 setEffort changes the derived strictness; an invalid level is IGNORED', () => {
  const c = createEffortController({ effort: 'high' })
  c.setEffort('max')
  assert.equal(c.getStrictness(), 'paranoid')
  c.setEffort('bogus') // ignored — keeps the prior valid effort
  assert.equal(c.getEffort(), 'max')
  c.setEffort(undefined)
  assert.equal(c.getEffort(), 'max')
})

// ── C. the effort → strictness mapping (configurable, fail-safe) ─────────────

test('C1 a custom mapping is honored', () => {
  const c = createEffortController({ mapping: { off: 'paranoid', high: 'paranoid', max: 'paranoid' } })
  assert.equal(c.getDefaultDecision(), 'deny') // off now maps to paranoid → deny
  c.setEffort('high')
  assert.equal(c.getDefaultDecision(), 'deny')
})

test('C2 setStrictnessByEffort replaces the mapping; invalid entries fall back to default', () => {
  const c = createEffortController()
  c.setStrictnessByEffort({ off: 'bogus', high: 'paranoid' }) // off invalid → default 'lenient'; max missing → default 'paranoid'
  assert.deepEqual(c.getStrictnessMapping(), { off: 'lenient', high: 'paranoid', max: 'paranoid' })
})

test('C3 a non-object mapping yields the full DEFAULT (never a permissive bypass)', () => {
  for (const bad of [42, null, undefined, 'x', []]) {
    const c = createEffortController({ mapping: bad })
    assert.deepEqual(c.getStrictnessMapping(), DEFAULT_EFFORT_STRICTNESS)
  }
})

test('C4 getStrictnessMapping returns a COPY — the caller cannot mutate the internal mapping', () => {
  const c = createEffortController()
  const m = c.getStrictnessMapping()
  m.off = 'paranoid'
  assert.equal(c.getStrictness(), 'lenient') // internal mapping unchanged
})

test('C5 never throws on any garbage input', () => {
  assert.doesNotThrow(() => {
    createEffortController(null)
    createEffortController(42)
    const c = createEffortController({ effort: {}, mapping: 7 })
    c.setEffort(null)
    c.setEffort([])
    c.setStrictnessByEffort(null)
    c.setStrictnessByEffort('nope')
  })
})

test('C6 SECURITY: a polluted Object.prototype does NOT downgrade the conservative default', () => {
  // own-key reads only — an inherited value must not weaken the fail-safe default.
  const saved = Object.prototype.max
  try {
    Object.prototype.max = 'lenient' // classic pollution gadget from elsewhere in-process
    const c = createEffortController({ effort: 'max', mapping: {} }) // empty OWN mapping
    assert.equal(c.getStrictness(), 'paranoid') // NOT the inherited 'lenient'
    assert.equal(c.getDefaultDecision(), 'deny') // fail-closed for the missing key
  } finally {
    if (saved === undefined) delete Object.prototype.max
    else Object.prototype.max = saved
  }
})

test('C7 never throws on accessor-bearing inputs; a throwing getter → conservative default', () => {
  const throwingGetterMapping = () => {
    const m = {}
    Object.defineProperty(m, 'max', { enumerable: true, get() { throw new Error('boom') } })
    return m
  }
  assert.doesNotThrow(() => {
    createEffortController({ mapping: new Proxy({}, { get() { throw new Error('boom') } }) })
    createEffortController(new Proxy({}, { get() { throw 0 } }))
    createEffortController(new Proxy({}, { getOwnPropertyDescriptor() { throw 0 }, has() { throw 0 } }))
    createEffortController({ mapping: throwingGetterMapping() })
    createEffortController().setStrictnessByEffort(new Proxy({}, { get() { throw 0 } }))
  })
  // a throwing max-getter falls back to the conservative default (paranoid), not a weaker value
  const c = createEffortController({ effort: 'max', mapping: throwingGetterMapping() })
  assert.equal(c.getStrictness(), 'paranoid')
  assert.equal(c.getDefaultDecision(), 'deny')
})

// ── D. the bridge: effort's default decision drives resolveResourceDecision ──

test('D1 effort feeds the rule engine NO-MATCH default, but NEVER overrides a deny', () => {
  const rules = [{ layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny' }]
  // paranoid (max effort) → an UN-ruled access defaults to deny...
  const paranoid = createEffortController({ effort: 'max' })
  assert.equal(
    resolveResourceDecision({ resource: 'fs-read', target: '/unlisted', rules, defaultDecision: paranoid.getDefaultDecision() }).decision,
    'deny',
  )
  // ...while a lenient/standard effort defers an un-ruled access to ask
  const lenient = createEffortController({ effort: 'off' })
  assert.equal(
    resolveResourceDecision({ resource: 'fs-read', target: '/unlisted', rules, defaultDecision: lenient.getDefaultDecision() }).decision,
    'ask',
  )
  // a MATCHING deny is enforced regardless of effort (deny-first absolute)
  for (const ctrl of [paranoid, lenient]) {
    assert.equal(
      resolveResourceDecision({ resource: 'fs-read', target: '/secret', rules, defaultDecision: ctrl.getDefaultDecision() }).decision,
      'deny',
    )
  }
})
