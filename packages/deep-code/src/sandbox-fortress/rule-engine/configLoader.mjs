// Pure, node-testable parser: a user `settings.fortress` block → validated fortress
// rulesets (grouped by layer) + effort level + warnings (F3 wiring PR-E). Standalone —
// nothing imports it until the manager-init wiring does, so by itself dist is
// byte-identical.
//
// The user-facing config shape (chosen explicit form):
//   "fortress": {
//     "effort": "off" | "high" | "max",
//     "rules": [
//       { "layer": "user", "resource": "fs-write", "pattern": "~/.ssh/**", "action": "deny",
//         "reason": "protect ssh keys", "expiresAt": 1750000000000 }
//     ]
//   }
//
// FAIL-SAFE like the cores: never throws on any caller input; an invalid effort or a
// malformed rule is dropped with a warning, never silently weakening or crashing the
// fortress. Path normalization is INJECTED (options.normalizePattern) so this core stays
// pure — the wiring passes the same expandPath-based normalizer the sandbox adapter uses,
// turning '~'/relative patterns into the absolute form the OS projector can enforce.

import { VALID_ACTIONS, VALID_LAYERS, VALID_RESOURCES } from './resolveRules.mjs'
import { EFFORT_LEVELS } from './effort.mjs'

const VALID_EFFORT = new Set(EFFORT_LEVELS)
const FS_RESOURCES = new Set(['fs-read', 'fs-write'])
const DEFAULT_LAYER = 'user'

// Own-key, throw-safe read (a polluted Object.prototype can't inject a value; a hostile
// getter can't break the never-throws contract).
function safeGet(obj, key) {
  try {
    return obj != null && Object.hasOwn(obj, key) ? obj[key] : undefined
  } catch {
    return undefined
  }
}

// Throw-safe own-key PRESENCE check (Object.hasOwn does not invoke a getter, so this is
// true even when reading the value would throw — lets us tell an ABSENT key from a
// present-but-undefined/unreadable one).
function safeHasOwn(obj, key) {
  try {
    return obj != null && Object.hasOwn(obj, key)
  } catch {
    return false
  }
}

// Format an arbitrary (possibly hostile) value for a warning message WITHOUT throwing —
// JSON.stringify throws on BigInt / circular refs / a throwing toJSON, which would
// otherwise abort parsing. Falls back to String(), then a literal.
function safeStringify(value) {
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    /* BigInt / circular / throwing toJSON → fall through */
  }
  try {
    return String(value)
  } catch {
    return '[unprintable]'
  }
}

// Keep only the recognized, well-typed metadata fields (reason/expiresAt) — never carry
// arbitrary user keys into a FortressRule.
function parseMetadata(rule) {
  const out = {}
  const reason = safeGet(rule, 'reason')
  if (typeof reason === 'string' && reason !== '') out.reason = reason
  const expiresAt = safeGet(rule, 'expiresAt')
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) out.expiresAt = expiresAt
  return Object.keys(out).length > 0 ? out : undefined
}

function parseRule(rule, index, normalizePattern, warnings) {
  if (rule == null || typeof rule !== 'object') {
    warnings.push(`fortress.rules[${index}]: not an object (ignored)`)
    return null
  }
  // OWN-key, throw-safe reads — a polluted Object.prototype must not inject a field and
  // an inherited/hostile-getter value must not be accepted or break the never-throws
  // contract (a rule comes from JSON.parse with OWN keys; we read it that way).
  const resource = safeGet(rule, 'resource')
  const action = safeGet(rule, 'action')
  const pattern = safeGet(rule, 'pattern')
  const layer = safeGet(rule, 'layer')
  const layerPresent = safeHasOwn(rule, 'layer') // present-but-invalid ≠ absent

  if (!VALID_RESOURCES.has(resource)) {
    warnings.push(`fortress.rules[${index}]: invalid resource ${safeStringify(resource)} (ignored)`)
    return null
  }
  if (!VALID_ACTIONS.has(action)) {
    warnings.push(`fortress.rules[${index}]: invalid action ${safeStringify(action)} (ignored)`)
    return null
  }
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    warnings.push(`fortress.rules[${index}]: pattern must be a non-empty, non-blank string (ignored)`)
    return null
  }
  // Trim surrounding whitespace (a config typo); never store a blank/padded path that
  // would otherwise normalize to an active cwd deny.
  const cleanPattern = pattern.trim()

  // Layer resolution. ABSENT key → 'user' (lowest trust). A VALID value is honored. A
  // PRESENT-but-INVALID value (a typo, null, undefined, or an unreadable getter):
  //   • a DENY is kept at 'user' (a deny must NOT be silently lost — "looks-configured-
  //     but-isn't"; trust rank is irrelevant to a deny under deny-first-absolute), and
  //   • an ALLOW/ASK is DROPPED (never activate a grant/ask at a guessed trust level).
  let resolvedLayer = DEFAULT_LAYER
  if (VALID_LAYERS.has(layer)) {
    resolvedLayer = layer
  } else if (layerPresent) {
    if (action !== 'deny') {
      warnings.push(`fortress.rules[${index}]: invalid layer ${safeStringify(layer)} on a non-deny rule (dropped)`)
      return null
    }
    warnings.push(`fortress.rules[${index}]: invalid layer ${safeStringify(layer)} (deny kept at '${DEFAULT_LAYER}')`)
  }

  // Normalize ONLY filesystem patterns (a net-host/process-exec pattern is not a path).
  let outPattern = cleanPattern
  if (FS_RESOURCES.has(resource)) {
    let normalized
    try {
      normalized = normalizePattern(cleanPattern, resource)
    } catch {
      normalized = undefined
    }
    if (typeof normalized === 'string' && normalized !== '') outPattern = normalized
  }

  const out = { layer: resolvedLayer, resource, pattern: outPattern, action }
  const metadata = parseMetadata(rule)
  if (metadata) out.metadata = metadata
  return out
}

/**
 * Parse a `settings.fortress` block into validated rulesets (grouped by layer) + an
 * effort level. Never throws. Invalid entries are dropped with a warning.
 * @param {unknown} fortress  the settings.fortress object (untrusted)
 * @param {{normalizePattern?: (pattern: string, resource: string) => string}} [options]
 *   normalizePattern turns a fs pattern into the absolute form the OS projector enforces
 *   (default: identity). It is only applied to fs-read/fs-write patterns.
 * @returns {{rulesByLayer: Record<string, Array<object>>, effort: (string|undefined), warnings: string[]}}
 */
export function parseFortressSettings(fortress, options = {}) {
  // Own-key, throw-safe read of the injected normalizer (a hostile Proxy options bag
  // whose get trap throws must not break the never-throws contract).
  const rawNormalize = safeGet(options, 'normalizePattern')
  const normalizePattern = typeof rawNormalize === 'function' ? rawNormalize : p => p
  const warnings = []
  const rulesByLayer = {}
  let effort

  if (fortress == null || typeof fortress !== 'object') return { rulesByLayer, effort, warnings }

  const rawEffort = safeGet(fortress, 'effort')
  if (rawEffort !== undefined) {
    if (VALID_EFFORT.has(rawEffort)) effort = rawEffort
    else warnings.push(`fortress.effort: invalid value ${safeStringify(rawEffort)} (expected off|high|max; ignored)`)
  }

  const rawRules = safeGet(fortress, 'rules')
  if (rawRules !== undefined) {
    // Guard the whole array handling: Array.isArray throws on a revoked proxy, and a
    // hostile Proxy array's length/index reads can throw — neither must break the
    // never-throws contract (the rules are then dropped with a warning).
    try {
      if (!Array.isArray(rawRules)) {
        warnings.push('fortress.rules: must be an array (ignored)')
      } else {
        for (let i = 0; i < rawRules.length; i++) {
          const parsed = parseRule(rawRules[i], i, normalizePattern, warnings)
          if (parsed) {
            if (!rulesByLayer[parsed.layer]) rulesByLayer[parsed.layer] = []
            rulesByLayer[parsed.layer].push(parsed)
          }
        }
      }
    } catch {
      warnings.push('fortress.rules: could not be read (ignored)')
    }
  }

  return { rulesByLayer, effort, warnings }
}

/** The fortress layers, in apply order (lowest trust → highest). Exposed so the wiring
 *  can setRuleset every layer (clearing a layer whose rules were all removed). */
export const FORTRESS_LAYERS = ['builtin-default', 'org', 'agent', 'user']
