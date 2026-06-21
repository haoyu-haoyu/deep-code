import assert from 'node:assert/strict'
import { test } from 'node:test'

import { permittedRuleSourcesUnderLockdown } from '../src/utils/permissions/permittedRuleSourcesUnderLockdown.mjs'

// Mirror of permissions.ts PERMISSION_RULE_SOURCES order.
const ALL_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
  'cliArg',
  'command',
  'session',
]

test('lockdown OFF: returns every source unchanged (same reference)', () => {
  const out = permittedRuleSourcesUnderLockdown(ALL_SOURCES, false)
  assert.equal(out, ALL_SOURCES)
})

test('lockdown ON: only managed (policy) + launch-flag sources survive', () => {
  const out = permittedRuleSourcesUnderLockdown(ALL_SOURCES, true)
  assert.deepEqual(out, ['flagSettings', 'policySettings'])
})

test("THE FIX: lockdown ON drops the in-memory 'command' source", () => {
  // a workspace/plugin slash-command allowed-tools self-grant lands in 'command'
  const out = permittedRuleSourcesUnderLockdown(ALL_SOURCES, true)
  assert.ok(!out.includes('command'), "'command' must not survive the lockdown")
})

test('lockdown ON drops every source the scrub already clears (cliArg/session/disk)', () => {
  const out = permittedRuleSourcesUnderLockdown(ALL_SOURCES, true)
  for (const dropped of [
    'userSettings',
    'projectSettings',
    'localSettings',
    'cliArg',
    'session',
    'command',
  ]) {
    assert.ok(!out.includes(dropped), `${dropped} must be dropped under lockdown`)
  }
})

test('lockdown ON preserves the policySettings admin source', () => {
  const out = permittedRuleSourcesUnderLockdown(ALL_SOURCES, true)
  assert.ok(out.includes('policySettings'))
})

test('order is preserved among the surviving sources', () => {
  const reordered = ['policySettings', 'command', 'flagSettings', 'session']
  const out = permittedRuleSourcesUnderLockdown(reordered, true)
  assert.deepEqual(out, ['policySettings', 'flagSettings'])
})

test('empty input is handled', () => {
  assert.deepEqual(permittedRuleSourcesUnderLockdown([], true), [])
  assert.deepEqual(permittedRuleSourcesUnderLockdown([], false), [])
})
