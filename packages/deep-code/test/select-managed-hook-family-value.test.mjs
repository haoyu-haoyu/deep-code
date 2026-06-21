import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectManagedHookFamilyValue } from '../src/utils/hooks/selectManagedHookFamilyValue.mjs'

const POLICY = { type: 'command', command: 'managed' }
const MERGED = { type: 'command', command: 'project-or-merged' }

test('no lockdown -> the merged value runs (byte-identical legacy/no-policy behavior)', () => {
  assert.equal(
    selectManagedHookFamilyValue({
      managedOnly: false,
      pluginOnlyLocked: false,
      policyValue: POLICY,
      mergedValue: MERGED,
    }),
    MERGED,
  )
})

test('THE FIX: strictPluginOnlyCustomization(hooks) lock -> only the managed value runs', () => {
  assert.equal(
    selectManagedHookFamilyValue({
      managedOnly: false,
      pluginOnlyLocked: true, // a project statusLine/fileSuggestion must NOT run
      policyValue: POLICY,
      mergedValue: MERGED,
    }),
    POLICY,
  )
})

test('allowManagedHooksOnly lock -> only the managed value runs (pre-existing behavior preserved)', () => {
  assert.equal(
    selectManagedHookFamilyValue({
      managedOnly: true,
      pluginOnlyLocked: false,
      policyValue: POLICY,
      mergedValue: MERGED,
    }),
    POLICY,
  )
})

test('either lock active -> managed value; all four boolean combos', () => {
  for (const managedOnly of [true, false]) {
    for (const pluginOnlyLocked of [true, false]) {
      const expected = managedOnly || pluginOnlyLocked ? POLICY : MERGED
      assert.equal(
        selectManagedHookFamilyValue({
          managedOnly,
          pluginOnlyLocked,
          policyValue: POLICY,
          mergedValue: MERGED,
        }),
        expected,
        `managedOnly=${managedOnly} pluginOnlyLocked=${pluginOnlyLocked}`,
      )
    }
  }
})

test('under a lock with NO managed value, the result is undefined -> the command is skipped', () => {
  // an admin who locks plugin-only but defines no managed statusLine = no command runs
  assert.equal(
    selectManagedHookFamilyValue({
      managedOnly: false,
      pluginOnlyLocked: true,
      policyValue: undefined,
      mergedValue: MERGED,
    }),
    undefined,
  )
})
