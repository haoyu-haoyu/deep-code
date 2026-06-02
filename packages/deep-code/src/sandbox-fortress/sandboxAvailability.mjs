// Pure platform/availability decision for the legacy sandbox. Extracted from
// adapter/legacy.ts so the branch-heavy, security-adjacent gating is unit-
// testable under `node --test` (the .ts side keeps the I/O: platform detection,
// settings reads, dependency checks). No node builtins, no imports — pure.

/**
 * Whether the current platform is permitted by the (undocumented)
 * `sandbox.enabledPlatforms` allowlist:
 *   - undefined list  → ALL platforms allowed (true)        [the default]
 *   - empty list `[]` → NO platforms allowed (false)        [explicit kill-switch]
 *   - otherwise       → membership of `platform` in the list
 * Mirrors the original exactly; a malformed (non-array) list throws, which the
 * .ts wrapper's try/catch turns into the fail-open default (true).
 */
export function isPlatformInEnabledList(platform, enabledPlatforms) {
  if (enabledPlatforms === undefined) return true
  if (enabledPlatforms.length === 0) return false
  return enabledPlatforms.includes(platform)
}

/**
 * If the user explicitly enabled sandbox but it cannot actually run, return a
 * human-readable reason; otherwise undefined. This is the #34044 footgun guard:
 * isSandboxingEnabled() silently returns false when a precondition fails, so
 * this surfaces WHY at startup. NEVER warns when the user did not enable sandbox.
 *
 * `getDepErrors()` is a thunk so the (expensive) dependency check is only run
 * when the cheaper gates (enabled → supported → in-list) have all passed —
 * preserving the original's short-circuit order.
 *
 * @returns {string | undefined}
 */
export function sandboxUnavailableReason({ enabledSetting, supported, platform, inList, getDepErrors }) {
  if (!enabledSetting) return undefined
  if (!supported) {
    return platform === 'wsl'
      ? 'sandbox.enabled is set but WSL1 is not supported (requires WSL2)'
      : `sandbox.enabled is set but ${platform} is not supported (requires macOS, Linux, or WSL2)`
  }
  if (!inList) {
    return `sandbox.enabled is set but ${platform} is not in sandbox.enabledPlatforms`
  }
  const depErrors = getDepErrors()
  if (depErrors.length > 0) {
    const hint =
      platform === 'macos'
        ? 'run /sandbox or /doctor for details'
        : 'install missing tools (e.g. apt install bubblewrap socat) or run /sandbox for details'
    return `sandbox.enabled is set but dependencies are missing: ${depErrors.join(', ')} · ${hint}`
  }
  return undefined
}
