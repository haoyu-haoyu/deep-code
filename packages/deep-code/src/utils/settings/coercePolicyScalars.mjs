// Coerce a present-but-INVALID security-critical settings scalar to a FAIL-CLOSED
// value, in place, BEFORE the whole-object Zod parse of a MANAGED-policy file.
//
// Why: SettingsSchema().safeParse rejects the WHOLE object when any single
// recognized key holds a wrong-typed value, and parseSettingsFile then returns
// `settings: null` for that file. For a managed-policy source (the admin-owned
// managed-settings.json / MDM plist / registry) whose file IS the only policy,
// one mistyped key (e.g. `"disableBypassPermissionsMode": "disabled"`) therefore
// silently drops EVERY OTHER restriction in the same file — the correctly-spelled
// deny rules, allowManagedPermissionRulesOnly, a sibling disableBypassPermissionsMode
// — re-enabling bypassPermissions and dropping the deny list. That is a silent,
// total fail-OPEN of the org lockdown.
//
// This mirrors filterInvalidPermissionRules, which already salvages the permission
// ARRAYS the same way so one bad rule can't poison the file. Here we salvage the
// security-critical SCALARS: a present-but-invalid value degrades to the field's
// MOST RESTRICTIVE setting (fail-closed) so the malformed policy never relaxes the
// lockdown, and — by becoming schema-valid — no longer nulls the rest of the file.
//
// defaultMode is intentionally NOT handled here: it is the one field with a safe
// app default (an absent defaultMode forces nothing), and its enum is feature-gated,
// so it is dropped to undefined by a `.catch(undefined)` on the schema field itself
// rather than guessing which restrictive mode the admin intended.
//
// Scope (honest residual): this salvages the security-critical SCALARS only. A typo
// on some OTHER recognized key (an unrelated `env`, `model`, a malformed array) still
// fails the whole-object parse and nulls the managed file — that broader robustness
// gap (fail-closed-on-any-managed-parse-error / per-key salvage) is a separate change.
// What this closes is the confirmed security case: a mistyped value on one of these
// lockdown scalars no longer silently re-opens the org policy.

// enum(['disable']) fields: 'disable' is the only valid (restrictive) value, so any
// present value other than 'disable' (a typo, a boolean, null) => 'disable'.
const DISABLE_ENUM_FIELDS = [
  {
    container: 'permissions',
    key: 'disableBypassPermissionsMode',
    note: 'bypass-permissions mode stays disabled',
  },
  {
    container: 'permissions',
    key: 'disableAutoMode',
    note: 'auto mode stays disabled',
  },
  { container: null, key: 'disableAutoMode', note: 'auto mode stays disabled' },
]

// boolean "only honor managed policy" fields: the restrictive value is `true`
// (only managed settings apply), so any present non-boolean => true. All three
// allowManaged*Only lockdowns are the same family — coerce them consistently, or a
// typo on the omitted one still nulls the whole file and re-opens that surface.
const MANAGED_ONLY_BOOL_FIELDS = [
  {
    key: 'allowManagedPermissionRulesOnly',
    note: 'only managed permission rules apply',
  },
  {
    key: 'allowManagedMcpServersOnly',
    note: 'only the managed MCP server allowlist applies',
  },
  {
    key: 'allowManagedHooksOnly',
    note: 'only managed hooks run',
  },
]

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Fail-close present-but-invalid security scalars in a managed-policy settings
 * object, mutating `data` in place. Returns a ValidationError[] (file/path/
 * message/invalidValue) for each coercion, to surface in /doctor.
 *
 * @param {unknown} data raw parsed JSON of a MANAGED settings source
 * @param {string} filePath the source path (for the warning's `file`)
 */
export function coercePolicyScalars(data, filePath) {
  const warnings = []
  if (!isPlainObject(data)) return warnings

  for (const { container, key, note } of DISABLE_ENUM_FIELDS) {
    const target = container == null ? data : data[container]
    if (!isPlainObject(target)) continue
    const value = target[key]
    if (value !== undefined && value !== 'disable') {
      const path = container == null ? key : `${container}.${key}`
      warnings.push({
        file: filePath,
        path,
        message:
          `Invalid value for "${path}" in a managed-policy settings file; ` +
          `coerced to the fail-closed default "disable" (${note}). ` +
          `Fix the managed settings file.`,
        invalidValue: value,
      })
      target[key] = 'disable'
    }
  }

  for (const { key, note } of MANAGED_ONLY_BOOL_FIELDS) {
    const value = data[key]
    if (value !== undefined && typeof value !== 'boolean') {
      warnings.push({
        file: filePath,
        path: key,
        message:
          `Invalid value for "${key}" in a managed-policy settings file; ` +
          `coerced to the fail-closed default true (${note}). ` +
          `Fix the managed settings file.`,
        invalidValue: value,
      })
      data[key] = true
    }
  }

  return warnings
}
