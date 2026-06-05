// Pure, node-testable effort -> strictness -> default-decision coupling for the
// Sandbox Fortress (F3 PR-3). Backs FortressSandboxManager's setEffortLevel /
// getCurrentEffort / setStrictnessByEffort (manager.ts) as a standalone .mjs —
// nothing in src/ imports it yet (a later wiring PR does), so dist is byte-identical
// and the DeepSeek prefix-cache moat is untouched.
//
// The model: a session has an EFFORT level (how hard the fortress tries); a
// configurable mapping turns effort into a STRICTNESS level (how strict the policy
// is); strictness determines the rule engine's NO-MATCH default decision (the only
// security-relevant knob it feeds — resolveResourceDecision's `defaultDecision`).
// Effort NEVER weakens an explicit deny: the rule engine is deny-first ABSOLUTE
// regardless of effort; effort only decides what an UN-ruled access defaults to.
//
// FAIL-SAFE: never throws on caller input. An invalid effort/strictness/mapping
// entry falls back to the conservative DEFAULT rather than silently disabling the
// fortress — a misconfiguration must not become a permissive bypass.

export const EFFORT_LEVELS = Object.freeze(['off', 'high', 'max'])
export const STRICTNESS_LEVELS = Object.freeze(['lenient', 'standard', 'paranoid'])

const VALID_EFFORT = new Set(EFFORT_LEVELS)
const VALID_STRICTNESS = new Set(STRICTNESS_LEVELS)

// The default effort -> strictness mapping (off is permissive-but-interactive; max
// is fail-closed). A caller can override via setStrictnessByEffort.
export const DEFAULT_EFFORT_STRICTNESS = Object.freeze({
  off: 'lenient',
  high: 'standard',
  max: 'paranoid',
})

/**
 * Map a strictness level to the rule engine's NO-MATCH default decision. Only
 * `paranoid` blocks an un-ruled access ('deny'); lenient/standard (and any
 * unknown value, fail-safe) defer to the host's interactive permission callback
 * ('ask'). resolveResourceDecision only accepts 'ask' | 'deny' for defaultDecision.
 * @param {string} strictness
 * @returns {('ask'|'deny')}
 */
export function strictnessToDefaultDecision(strictness) {
  return strictness === 'paranoid' ? 'deny' : 'ask'
}

// Read an OWN property of `obj` (never inherited, so a polluted Object.prototype
// can't inject a value), tolerating a throwing accessor (→ undefined). Both matter
// for SECURITY config: an inherited value would let prototype pollution downgrade
// the conservative default to a permissive one, and a throwing getter must not
// break the never-throws contract. Object.hasOwn skips the get trap for an absent
// key; the try/catch covers an own throwing getter (and a hostile has/descriptor
// trap).
function safeGet(obj, key) {
  try {
    return Object.hasOwn(obj, key) ? obj[key] : undefined
  } catch {
    return undefined
  }
}

// Build a validated copy of an effort->strictness mapping: every effort key gets a
// valid strictness, falling back to DEFAULT_EFFORT_STRICTNESS for a missing/invalid
// entry (own-key only). A non-object mapping yields the full default. Never throws,
// never mutates.
function sanitizeMapping(mapping) {
  const out = {}
  const src = mapping != null && typeof mapping === 'object' ? mapping : {}
  for (const effort of EFFORT_LEVELS) {
    const value = safeGet(src, effort)
    out[effort] = VALID_STRICTNESS.has(value) ? value : DEFAULT_EFFORT_STRICTNESS[effort]
  }
  return out
}

/**
 * A small effort/strictness controller. Holds the current effort + the
 * effort->strictness mapping, and derives the current strictness + the rule
 * engine's default decision. All setters are fail-safe (invalid input ignored /
 * defaulted, never weakening the policy).
 * @param {{effort?: string, mapping?: Record<string,string>}} [options]
 */
export function createEffortController(options = {}) {
  const opts = options != null && typeof options === 'object' ? options : {}
  const initialEffort = safeGet(opts, 'effort')
  let effort = VALID_EFFORT.has(initialEffort) ? initialEffort : 'off'
  let mapping = sanitizeMapping(safeGet(opts, 'mapping'))

  return {
    /** Set the current effort. An invalid level is IGNORED (keeps the prior effort). */
    setEffort(level) {
      if (VALID_EFFORT.has(level)) effort = level
    },
    getEffort() {
      return effort
    },
    /** Replace the effort->strictness mapping (validated; invalid entries → default). */
    setStrictnessByEffort(newMapping) {
      mapping = sanitizeMapping(newMapping)
    },
    /** A copy of the active mapping (callers can't mutate the internal one). */
    getStrictnessMapping() {
      return { ...mapping }
    },
    /** The strictness implied by the current effort. */
    getStrictness() {
      return mapping[effort]
    },
    /** The rule engine's no-match default decision for the current strictness. */
    getDefaultDecision() {
      return strictnessToDefaultDecision(mapping[effort])
    },
  }
}
