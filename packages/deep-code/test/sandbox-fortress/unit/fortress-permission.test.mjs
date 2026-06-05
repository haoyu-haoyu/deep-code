import test from 'node:test'
import assert from 'node:assert/strict'

import { fortressDecisionDirective } from '../../../src/sandbox-fortress/rule-engine/fortressPermission.mjs'

// ── F3 PR-F: fortress decision → file-tool enforcement directive (pure) ──────────

const matchedRule = { layer: 'user', resource: 'fs-read', pattern: '/secret', action: 'deny' }

test('A1 a MATCHED deny → block + record', () => {
  const d = fortressDecisionDirective({ decision: 'deny', rule: matchedRule, reason: 'match' })
  assert.equal(d.enforce, 'deny')
  assert.equal(d.record, true)
  assert.equal(d.dryRun, false)
  assert.equal(d.matched, true)
})

test('A2 a no-match (paranoid) deny → block but do NOT record (effort posture, not a breach)', () => {
  const d = fortressDecisionDirective({ decision: 'deny', rule: null, reason: 'no-match:deny' })
  assert.equal(d.enforce, 'deny')
  assert.equal(d.record, false)
  assert.equal(d.matched, false)
})

test('A3 a MATCHED ask rule → prompt (ask), no record', () => {
  const d = fortressDecisionDirective({ decision: 'ask', rule: { ...matchedRule, action: 'ask' }, reason: 'match' })
  assert.equal(d.enforce, 'ask')
  assert.equal(d.record, false)
})

test('A4 the no-match ask default (effort off/standard) → DEFER (inert; host decides)', () => {
  const d = fortressDecisionDirective({ decision: 'ask', rule: null, reason: 'no-match:ask' })
  assert.equal(d.enforce, 'defer')
  assert.equal(d.record, false)
  assert.equal(d.matched, false)
})

test('A5 an allow rule → DEFER (the fortress never force-allows; host decides)', () => {
  const d = fortressDecisionDirective({ decision: 'allow', rule: { ...matchedRule, action: 'allow' }, reason: 'match' })
  assert.equal(d.enforce, 'defer')
  assert.equal(d.record, false)
})

test('A6 DRY-RUN: a would-be deny does NOT block (defer) but IS recorded with dryRun', () => {
  const matched = fortressDecisionDirective({ decision: 'deny', rule: matchedRule }, { dryRun: true })
  assert.equal(matched.enforce, 'defer') // log-only, not blocked
  assert.equal(matched.record, true)
  assert.equal(matched.dryRun, true)
  // a paranoid no-match deny in dry-run also defers, and stays unrecorded
  const noMatch = fortressDecisionDirective({ decision: 'deny', rule: null }, { dryRun: true })
  assert.equal(noMatch.enforce, 'defer')
  assert.equal(noMatch.record, false)
})

test('A7 garbage / missing decision → DEFER (fail-safe, never enforces a block on junk)', () => {
  for (const bad of [undefined, null, 42, {}, { decision: 'bogus' }, { decision: 'allow' }]) {
    const d = fortressDecisionDirective(bad)
    assert.equal(d.enforce, 'defer', `bad=${JSON.stringify(bad)}`)
    assert.equal(d.record, false)
  }
})
