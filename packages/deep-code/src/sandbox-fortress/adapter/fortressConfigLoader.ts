import { getOriginalCwd } from '../../bootstrap/state.js'
import { expandPath } from '../../utils/path.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { FORTRESS_LAYERS, parseFortressSettings } from '../rule-engine/configLoader.mjs'
import type { EffortLevel, FortressRule, RulesetLayer } from '../types.js'

/** The subset of the fortress manager this loader drives. */
export interface FortressConfigTarget {
  setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void> | void
  setEffortLevel(effort: EffortLevel): Promise<void> | void
}

/**
 * Load + apply the user's `settings.fortress` block into a FortressSandboxManager
 * (F3 wiring PR-E — what makes enforcement user-reachable).
 *
 * It validates + path-normalizes the rules via the pure configLoader core, then
 * setRuleset for EVERY layer (so a layer whose rules were removed is CLEARED, not
 * left stale on reload) and setEffortLevel if configured. Filesystem patterns are
 * normalized with expandPath against the original cwd — the same '~'/relative →
 * absolute resolution the sandbox adapter uses for settings paths — so they reach the
 * OS projector (PR-D) in the absolute form it can enforce. Never throws; returns the
 * validation warnings for the caller to log/surface.
 */
export function applyFortressConfigFromSettings(
  manager: FortressConfigTarget,
  settings: SettingsJson | undefined,
): string[] {
  const cwd = getOriginalCwd()
  const normalizePattern = (pattern: string, resource: string): string => {
    // Only filesystem patterns are paths; a net-host / process-exec pattern is left
    // verbatim. expandPath turns '~'/relative into an absolute path and preserves globs.
    if (resource === 'fs-read' || resource === 'fs-write') {
      try {
        return expandPath(pattern, cwd)
      } catch {
        return pattern
      }
    }
    return pattern
  }

  const { rulesByLayer, effort, warnings } = parseFortressSettings(settings?.fortress, { normalizePattern })

  // Apply EVERY layer (empty when the user removed all of a layer's rules) so a reload
  // after a config edit clears the old rules rather than leaving them stale.
  for (const layer of FORTRESS_LAYERS) {
    manager.setRuleset(layer as RulesetLayer, (rulesByLayer[layer] ?? []) as FortressRule[])
  }
  if (effort !== undefined) manager.setEffortLevel(effort as EffortLevel)

  return warnings
}
