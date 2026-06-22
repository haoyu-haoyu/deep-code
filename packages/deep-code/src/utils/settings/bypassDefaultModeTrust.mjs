/**
 * The settings sources TRUSTED to set a security-sensitive
 * `permissions.defaultMode` of `'bypassPermissions'`.
 *
 * `projectSettings` is intentionally OMITTED — a project's `.claude/settings.json`
 * is folder-trust-gated and attacker-influenceable. The interactive TUI blocks a
 * project-sourced bypass via the BypassPermissionsModeDialog (whose consent reader
 * `hasSkipDangerousModePermissionPrompt` also excludes projectSettings), but the
 * headless `--print` path never reaches that dialog — so a project-sourced
 * `defaultMode: bypassPermissions` would otherwise silently grant full,
 * unprompted Bash/Edit/Write (RCE risk). This list mirrors the trusted-source set
 * used by `hasSkipDangerousModePermissionPrompt`.
 */
export const TRUSTED_BYPASS_DEFAULT_MODE_SOURCES = [
  'userSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]

/**
 * Returns true iff a TRUSTED (non-project) settings source sets
 * `permissions.defaultMode` to `'bypassPermissions'`.
 *
 * Pure value-in/value-out: the single settings reader is injected so the
 * predicate is node-testable. `projectSettings` is never queried, so a malicious
 * project cannot influence the result regardless of the injected reader.
 *
 * @param {(source: string) => ({ permissions?: { defaultMode?: unknown } } | null | undefined)} getForSource
 *   reads one settings source's parsed JSON (bind to `getSettingsForSource`).
 * @returns {boolean}
 */
export function isBypassDefaultModeTrusted(getForSource) {
  if (typeof getForSource !== 'function') return false
  for (const source of TRUSTED_BYPASS_DEFAULT_MODE_SOURCES) {
    const settings = getForSource(source)
    if (settings?.permissions?.defaultMode === 'bypassPermissions') {
      return true
    }
  }
  return false
}
