import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod/v4/index.js'

import { coercePolicyScalars } from '../src/utils/settings/coercePolicyScalars.mjs'

// A faithful mirror of the security scalars in SettingsSchema (types.ts): the
// enum('disable') fields and the boolean managed-only fields, plus a permissions
// deny array and an unrelated field to prove they survive. We mirror (rather than
// import) because types.ts pulls in bun:bundle and is not node-loadable; the field
// shapes here are kept byte-equivalent to the real schema fields under test.
const MirrorSchema = z
  .object({
    permissions: z
      .object({
        deny: z.array(z.string()).optional(),
        disableBypassPermissionsMode: z.enum(['disable']).optional(),
        disableAutoMode: z.enum(['disable']).optional(),
      })
      .passthrough()
      .optional(),
    disableAutoMode: z.enum(['disable']).optional(),
    allowManagedPermissionRulesOnly: z.boolean().optional(),
    allowManagedMcpServersOnly: z.boolean().optional(),
    allowManagedHooksOnly: z.boolean().optional(),
    // mirrors types.ts:493 — dropped to undefined on a present-but-invalid value
    // (ambiguous true/false direction) rather than coerced by the leaf
    disableAllHooks: z.boolean().optional().catch(undefined),
    model: z.string().optional(),
  })
  .passthrough()

test('a mistyped security scalar fails the raw parse (the bug it would null the file)', () => {
  const malformed = {
    permissions: {
      deny: ['Bash(curl:*)'],
      disableBypassPermissionsMode: 'disabled', // typo
    },
    allowManagedPermissionRulesOnly: true,
    model: 'opus',
  }
  // Before coercion the whole object is rejected -> parseSettingsFile returns null
  // -> the deny rule + allowManagedPermissionRulesOnly silently vanish.
  assert.equal(MirrorSchema.safeParse(malformed).success, false)
})

test('coercion makes the parse SUCCEED and fail-closes the bad scalar (deny + others preserved)', () => {
  const data = {
    permissions: {
      deny: ['Bash(curl:*)'],
      disableBypassPermissionsMode: 'disabled', // typo
    },
    allowManagedPermissionRulesOnly: true,
    model: 'opus',
  }
  const warnings = coercePolicyScalars(data, '/etc/managed-settings.json')

  const parsed = MirrorSchema.safeParse(data)
  assert.equal(parsed.success, true)
  // fail-closed: the typo'd toggle stays restrictive, not dropped/relaxed
  assert.equal(parsed.data.permissions.disableBypassPermissionsMode, 'disable')
  // every OTHER restriction in the same file survives
  assert.deepEqual(parsed.data.permissions.deny, ['Bash(curl:*)'])
  assert.equal(parsed.data.allowManagedPermissionRulesOnly, true)
  assert.equal(parsed.data.model, 'opus')
  // a warning is surfaced (for /doctor)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].path, 'permissions.disableBypassPermissionsMode')
  assert.equal(warnings[0].invalidValue, 'disabled')
  assert.equal(warnings[0].file, '/etc/managed-settings.json')
})

test('all three managed-only toggles fail-close to true (the whole allowManaged*Only family)', () => {
  const data = {
    allowManagedPermissionRulesOnly: 'yes', // typo (string, not bool)
    allowManagedMcpServersOnly: 1, // typo (number)
    allowManagedHooksOnly: 'true', // typo (string, not bool) — the 3rd sibling
  }
  const warnings = coercePolicyScalars(data, 'mdm')
  assert.equal(data.allowManagedPermissionRulesOnly, true)
  assert.equal(data.allowManagedMcpServersOnly, true)
  assert.equal(data.allowManagedHooksOnly, true)
  assert.equal(MirrorSchema.safeParse(data).success, true)
  assert.equal(warnings.length, 3)
})

test('a mistyped disableAllHooks is dropped by the schema .catch AND the sibling deny rule survives', () => {
  // the #577-sibling: disableAllHooks (types.ts:493) is a boolean lockdown with no
  // unambiguous restrictive direction, so it gets .catch(undefined) like defaultMode
  // (NOT leaf coercion). A string typo would otherwise null the WHOLE managed file,
  // dropping the deny rule too. The leaf does not touch it.
  const data = {
    permissions: { deny: ['Bash(curl:*)'] },
    disableAllHooks: 'true', // typo (string, not bool)
  }
  const warnings = coercePolicyScalars(data, '/etc/managed-settings.json')
  assert.equal(data.disableAllHooks, 'true') // leaf leaves it for the schema .catch
  const parsed = MirrorSchema.safeParse(data)
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.disableAllHooks, undefined) // dropped, hooks run (incl managed)
  assert.deepEqual(parsed.data.permissions.deny, ['Bash(curl:*)'])
  assert.equal(warnings.length, 0) // not a leaf-coerced field
})

test('a valid disableAllHooks (true or false) survives the schema .catch', () => {
  for (const v of [true, false]) {
    assert.equal(MirrorSchema.safeParse({ disableAllHooks: v }).data.disableAllHooks, v)
  }
})

test('top-level and nested disableAutoMode both fail-close to "disable"', () => {
  const data = {
    permissions: { disableAutoMode: true }, // typo (bool, not "disable")
    disableAutoMode: 'off', // typo (wrong enum)
  }
  const warnings = coercePolicyScalars(data, 'mdm')
  assert.equal(data.permissions.disableAutoMode, 'disable')
  assert.equal(data.disableAutoMode, 'disable')
  assert.equal(warnings.length, 2)
  assert.deepEqual(
    warnings.map(w => w.path).sort(),
    ['disableAutoMode', 'permissions.disableAutoMode'],
  )
})

test('null is treated as present-and-invalid (JSON null fails the optional enum)', () => {
  const data = { permissions: { disableBypassPermissionsMode: null } }
  const warnings = coercePolicyScalars(data, 'mdm')
  assert.equal(data.permissions.disableBypassPermissionsMode, 'disable')
  assert.equal(warnings.length, 1)
})

test('valid and absent values are left untouched (no spurious warnings, byte-identical)', () => {
  const data = {
    permissions: {
      deny: ['Bash(rm:*)'],
      disableBypassPermissionsMode: 'disable', // already valid
    },
    allowManagedMcpServersOnly: false, // valid boolean, must NOT flip to true
    // allowManagedPermissionRulesOnly absent
  }
  const before = JSON.stringify(data)
  const warnings = coercePolicyScalars(data, 'mdm')
  assert.equal(warnings.length, 0)
  assert.equal(JSON.stringify(data), before)
  // a valid `false` is preserved (not coerced to the restrictive true)
  assert.equal(data.allowManagedMcpServersOnly, false)
})

test('a non-object / array input is a no-op (never throws)', () => {
  assert.deepEqual(coercePolicyScalars(null, 'p'), [])
  assert.deepEqual(coercePolicyScalars(undefined, 'p'), [])
  assert.deepEqual(coercePolicyScalars(42, 'p'), [])
  assert.deepEqual(coercePolicyScalars([1, 2], 'p'), [])
  // permissions present but not an object: scalars under it are skipped safely
  assert.deepEqual(coercePolicyScalars({ permissions: 'bogus' }, 'p'), [])
})
