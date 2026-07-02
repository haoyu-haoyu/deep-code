import { test } from 'node:test'
import assert from 'node:assert/strict'

import { permissionSyncManagedClearSources } from '../src/utils/permissions/permissionSyncManagedClearSources.mjs'

// -- the leaf itself -------------------------------------------------------

test('off-lockdown clears BOTH managed sources (both are re-loaded)', () => {
  assert.deepEqual(permissionSyncManagedClearSources(false), [
    'policySettings',
    'flagSettings',
  ])
})

test('under lockdown clears ONLY policySettings (flagSettings is not re-loaded)', () => {
  // loadAllPermissionRulesFromDisk short-circuits to policySettings-only under
  // lockdown, so clearing flagSettings would drop the launch --settings grant
  // with nothing to re-apply it. It must be omitted.
  assert.deepEqual(permissionSyncManagedClearSources(true), ['policySettings'])
})

test('never returns an editable/in-memory source (those are cleared separately)', () => {
  for (const lockdown of [true, false]) {
    for (const src of permissionSyncManagedClearSources(lockdown)) {
      assert.ok(
        src === 'policySettings' || src === 'flagSettings',
        `unexpected managed clear source ${src}`,
      )
    }
  }
})

// -- end-to-end: prove the stale-grant is actually cleared -----------------
//
// Faithful ports of the two pieces syncPermissionRulesFromDisk composes:
//   applyPermissionUpdate('replaceRules') — PermissionUpdate.ts:98-121 (generic
//     computed-key write, works for policy/flag destinations too), and
//   convertRulesToUpdates(rules, 'replaceRules') — permissions.ts:1377-1405
//     (emits a replaceRules ONLY for a source:behavior pair with >=1 rule).
// Then we replicate syncPermissionRulesFromDisk's clear-then-reapply for the
// managed sources and assert a REMOVED policy grant no longer survives.

const RULE_KIND = { allow: 'alwaysAllowRules', deny: 'alwaysDenyRules', ask: 'alwaysAskRules' }

function applyReplaceRules(context, { behavior, destination, rules }) {
  const ruleKind = RULE_KIND[behavior]
  return {
    ...context,
    [ruleKind]: { ...context[ruleKind], [destination]: rules },
  }
}

function convertRulesToUpdatesReplace(rules) {
  const grouped = new Map()
  for (const r of rules) {
    const key = `${r.source}:${r.behavior}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(r.value)
  }
  const updates = []
  for (const [key, values] of grouped) {
    const [source, behavior] = key.split(':')
    updates.push({ behavior, destination: source, rules: values })
  }
  return updates
}

// The editable-disk clear (unchanged behavior) + the NEW managed clear + reapply.
function syncManaged(context, diskRules, lockdownActive) {
  let ctx = context
  for (const src of ['userSettings', 'projectSettings', 'localSettings']) {
    for (const behavior of ['allow', 'deny', 'ask']) {
      ctx = applyReplaceRules(ctx, { behavior, destination: src, rules: [] })
    }
  }
  for (const src of permissionSyncManagedClearSources(lockdownActive)) {
    for (const behavior of ['allow', 'deny', 'ask']) {
      ctx = applyReplaceRules(ctx, { behavior, destination: src, rules: [] })
    }
  }
  for (const u of convertRulesToUpdatesReplace(diskRules)) {
    ctx = applyReplaceRules(ctx, u)
  }
  return ctx
}

const emptyContext = () => ({
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
})

test('BUG FIXED: removing the last policySettings allow on disk clears the stale grant', () => {
  // Admin launched with an allow grant, then revoked it on disk.
  const ctx = { ...emptyContext(), alwaysAllowRules: { policySettings: ['Bash(curl:*)'] } }
  const diskAfterRevoke = [] // policy allow removed; nothing else
  const out = syncManaged(ctx, diskAfterRevoke, /*lockdown*/ true)
  assert.deepEqual(
    out.alwaysAllowRules.policySettings,
    [],
    'the revoked policy grant must NOT survive the sync',
  )
})

test('off-lockdown: removing the last flagSettings ask on disk clears the stale rule', () => {
  const ctx = { ...emptyContext(), alwaysAskRules: { flagSettings: ['Bash(rm:*)'] } }
  const out = syncManaged(ctx, [], /*lockdown*/ false)
  assert.deepEqual(out.alwaysAskRules.flagSettings, [])
})

test('a still-present policy grant is preserved (clear then re-apply)', () => {
  const ctx = { ...emptyContext(), alwaysAllowRules: { policySettings: ['Bash(curl:*)'] } }
  const diskStillHasIt = [{ source: 'policySettings', behavior: 'allow', value: 'Bash(curl:*)' }]
  const out = syncManaged(ctx, diskStillHasIt, /*lockdown*/ true)
  assert.deepEqual(out.alwaysAllowRules.policySettings, ['Bash(curl:*)'])
})

test('under lockdown a launch-time flagSettings grant is NOT dropped (not re-loaded, not cleared)', () => {
  // Under lockdown loadAllPermissionRulesFromDisk returns policy-only, so
  // flagSettings is absent from diskRules. It must remain frozen, not wiped.
  const ctx = { ...emptyContext(), alwaysAllowRules: { flagSettings: ['Bash(ls:*)'] } }
  const out = syncManaged(ctx, [], /*lockdown*/ true)
  assert.deepEqual(
    out.alwaysAllowRules.flagSettings,
    ['Bash(ls:*)'],
    'flagSettings must survive under lockdown (nothing would re-apply it)',
  )
})

// -- deny coverage (the #661-sensitive path) -------------------------------

test('a removed policy DENY on disk is cleared (deny flows through the same clear loop)', () => {
  // A revoked policy deny is a loosening the admin chose; it must actually take
  // effect (deny is re-loaded under both modes, so clearing it is safe).
  const ctx = { ...emptyContext(), alwaysDenyRules: { policySettings: ['Bash(rm:*)'] } }
  const out = syncManaged(ctx, [], /*lockdown*/ true)
  assert.deepEqual(out.alwaysDenyRules.policySettings, [])
})

test('NO DENY DROP: a still-on-disk policy deny is preserved, and a frozen flag deny survives lockdown', () => {
  // policy deny still on disk -> cleared then re-applied (never dropped).
  const ctxPolicy = { ...emptyContext(), alwaysDenyRules: { policySettings: ['Bash(rm:*)'] } }
  const diskHasDeny = [{ source: 'policySettings', behavior: 'deny', value: 'Bash(rm:*)' }]
  const outPolicy = syncManaged(ctxPolicy, diskHasDeny, /*lockdown*/ true)
  assert.deepEqual(outPolicy.alwaysDenyRules.policySettings, ['Bash(rm:*)'])

  // flag deny under lockdown -> not re-loaded, so must NOT be cleared (frozen).
  const ctxFlag = { ...emptyContext(), alwaysDenyRules: { flagSettings: ['Bash(curl:*)'] } }
  const outFlag = syncManaged(ctxFlag, [], /*lockdown*/ true)
  assert.deepEqual(outFlag.alwaysDenyRules.flagSettings, ['Bash(curl:*)'])
})
