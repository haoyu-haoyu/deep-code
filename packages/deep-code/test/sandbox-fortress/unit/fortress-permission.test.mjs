import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fortressDecisionDirective,
  fortressRecordVerb,
} from '../../../src/sandbox-fortress/rule-engine/fortressPermission.mjs'

// ── F3 PR-F: fortress decision → file-tool enforcement directive (pure) ──────────

const matchedRule = { layer: 'user', resource: 'fs-read', pattern: '/secret', action: 'deny' }

test('A1 a MATCHED deny → block + record', () => {
  const d = fortressDecisionDirective({ decision: 'deny', rule: matchedRule, reason: 'match' })
  assert.equal(d.enforce, 'deny')
  assert.equal(d.record, true)
  assert.equal(d.dryRun, false)
  assert.equal(d.matched, true)
  assert.equal(d.action, 'deny')
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
  assert.equal(d.action, 'ask')
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
    assert.equal(d.action, undefined)
  }
})

test('V1 fortressRecordVerb labels every (action, dryRun) — the single source of truth all 3 adapters share', () => {
  // The ask verbs (esp. the normal-mode "requires confirmation for") are not reachable via
  // the adapters today (a live ask is not recorded), so pin them directly here so the shared
  // label can never silently regress to a deny verb.
  assert.equal(fortressRecordVerb('deny', false), 'denied')
  assert.equal(fortressRecordVerb('deny', true), 'would deny')
  assert.equal(fortressRecordVerb('ask', false), 'requires confirmation for')
  assert.equal(fortressRecordVerb('ask', true), 'would require confirmation for')
  // an unknown/undefined action falls back to the deny verbs (defensive; only ever hit on
  // non-recording defer paths) — never throws.
  assert.equal(fortressRecordVerb(undefined, false), 'denied')
  assert.equal(fortressRecordVerb(undefined, true), 'would deny')
})

test('A8 DRY-RUN: a would-be (matched) ask does NOT prompt (defer) but IS recorded with dryRun', () => {
  const d = fortressDecisionDirective({ decision: 'ask', rule: { ...matchedRule, action: 'ask' } }, { dryRun: true })
  assert.equal(d.enforce, 'defer') // not actually prompted in dry-run (no behavior change)
  assert.equal(d.record, true) // but surfaced so the model/UI sees what WOULD have prompted
  assert.equal(d.dryRun, true)
  assert.equal(d.matched, true)
  assert.equal(d.action, 'ask') // labeled ask, so a recorder never mislogs it as a deny
  // a no-match ask default (inert) in dry-run stays a plain defer, unrecorded
  const noMatch = fortressDecisionDirective({ decision: 'ask', rule: null }, { dryRun: true })
  assert.equal(noMatch.enforce, 'defer')
  assert.equal(noMatch.record, false)
})
