import assert from 'node:assert/strict'
import { test } from 'node:test'

import { orderEnabledSettingSources } from '../src/utils/settings/settingSourceOrder.mjs'

// Canonical precedence (mirrors SETTING_SOURCES in src/utils/settings/constants.ts):
// later = higher precedence (merged last). policySettings MUST stay last.
const CANONICAL = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]

test('default path (all sources allowed) is byte-identical to canonical order', () => {
  // The Set-insertion implementation happened to be correct here; the fix must not
  // change the default output.
  assert.deepEqual(
    orderEnabledSettingSources([...CANONICAL], CANONICAL),
    CANONICAL,
  )
})

test('--setting-sources subset keeps policySettings last (managed policy un-overridable)', () => {
  // The bug: new Set(['userSettings']).add('policy').add('flag') yields
  // [userSettings, policySettings, flagSettings] → flag merges AFTER policy → a
  // user's --settings file overrides enterprise managed-settings.json.
  const ordered = orderEnabledSettingSources(['userSettings'], CANONICAL)
  assert.deepEqual(ordered, ['userSettings', 'flagSettings', 'policySettings'])
  assert.equal(
    ordered.at(-1),
    'policySettings',
    'policySettings must be last so it wins the merge',
  )
  assert.ok(
    ordered.indexOf('flagSettings') < ordered.indexOf('policySettings'),
    'flagSettings must never outrank policySettings',
  )
})

test('input order does not change precedence (canonical wins over typed order)', () => {
  // `--setting-sources project,user` must NOT make user override project.
  assert.deepEqual(
    orderEnabledSettingSources(['projectSettings', 'userSettings'], CANONICAL),
    ['userSettings', 'projectSettings', 'flagSettings', 'policySettings'],
  )
})

test('policy + flag are always present even when allowed is empty', () => {
  assert.deepEqual(
    orderEnabledSettingSources([], CANONICAL),
    ['flagSettings', 'policySettings'],
  )
})

test('policySettings is last for every subset of allowed sources', () => {
  const base = ['userSettings', 'projectSettings', 'localSettings']
  // every subset (2^3) — exhaustive over the user-selectable sources
  for (let mask = 0; mask < 1 << base.length; mask++) {
    const allowed = base.filter((_, i) => mask & (1 << i))
    const ordered = orderEnabledSettingSources(allowed, CANONICAL)
    assert.equal(
      ordered.at(-1),
      'policySettings',
      `policySettings must be last for allowed=[${allowed}]`,
    )
    assert.equal(
      ordered.at(-2),
      'flagSettings',
      `flagSettings must be second-last for allowed=[${allowed}]`,
    )
    // output is always a canonical-ordered subsequence
    assert.deepEqual(
      ordered,
      CANONICAL.filter(s => ordered.includes(s)),
    )
  }
})
