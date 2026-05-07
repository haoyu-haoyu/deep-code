/**
 * Pure helpers for reading env vars that have both a DeepCode-branded name
 * and a legacy upstream name. The DeepCode name is checked first so users
 * who set `DEEPCODE_*` get the documented behavior without needing to know
 * the upstream alias.
 *
 * Pure JS / no src/* imports so this module is loadable by `node --test`
 * directly (the Bun-build harness used elsewhere is overkill for tiny
 * helpers like these).
 */

/**
 * Strict positive-integer regex: requires the entire trimmed value to be
 * digits with no leading zeros (1, 75, 200 — not 0, 020, 1.5, 75abc, ' 7 ').
 * parseInt is intentionally NOT used because it accepts garbage like
 * '20.5' (→ 20) and '75abc' (→ 75), which would silently apply unintended
 * caps if a user typoes a settings value.
 */
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/

/**
 * Read the first env var name that is set to a strict positive integer.
 * Falls back to `fallback` when none of the names parse cleanly.
 */
export function readBranchedEnvInt(names, fallback, env = process.env) {
  for (const name of names) {
    const raw = env[name]
    if (raw === undefined || raw === null) continue
    const trimmed = String(raw).trim()
    if (!POSITIVE_INT_PATTERN.test(trimmed)) continue
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])

/**
 * Tri-state truthy: returns 'true', 'false', or 'unset'.
 *
 * Used by paths that distinguish "explicitly turned off" from "not set",
 * for example fullscreen mode where ant-internal default is true but an
 * explicit `0` must opt out even for ants.
 */
export function readBranchedEnvTriState(names, env = process.env) {
  for (const name of names) {
    const raw = env[name]
    if (raw === undefined || raw === null || raw === '') continue
    const normalized = String(raw).toLowerCase().trim()
    if (TRUTHY.has(normalized)) return 'true'
    if (FALSY.has(normalized)) return 'false'
  }
  return 'unset'
}

/**
 * Plain truthy boolean: returns true iff any of the listed env vars are
 * set to a truthy value. Skips empty / unset.
 */
export function readBranchedEnvBool(names, env = process.env) {
  return readBranchedEnvTriState(names, env) === 'true'
}
