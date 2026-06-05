// Pure, node-testable state machine for FortressSandboxManager (F3 wiring PR-A).
// Composes the three standalone cores — resolveRules.mjs (decision),
// violationLog.mjs (audit + dry-run), effort.mjs (effort->strictness) — with the
// in-memory state (per-layer rulesets, per-tool profiles) into the behavior behind
// FortressSandboxManager's 12 rule-engine methods. manager.ts (a bun-only .ts) will
// hold ONE of these and delegate each method to it in one line, so all the logic is
// here, node-testable, with ZERO adapter/runtime imports.
//
// STANDALONE: nothing in src/ imports it yet (PR-B wires manager.ts), so dist is
// byte-identical and the DeepSeek prefix-cache moat is untouched.
//
// CLOCK: this factory is the SINGLE place Date.now() enters the rule path (the
// cores never call it — they take an explicit `now`). `now` is an injectable thunk
// so tests freeze the clock. Passing `now` to resolveEffectiveRules ENABLES expiry
// filtering (omitting it would let expired denies linger — resolveRules.mjs).
//
// FAIL-SAFE like the cores: the factory and every method NEVER throw on caller
// garbage (null/Proxy-with-throwing-traps options, a throwing clock thunk, garbage
// rules/profiles/records). DEFENSIVE COPIES are DEEP on every store and read so a
// later caller mutation of a nested field (e.g. rule.metadata.expiresAt) can never
// silently flip a stored deny — the security invariant a shallow copy would break.

import {
  VALID_LAYERS,
  buildCacheFriendlyConfigSummary as coreBuildCacheFriendlyConfigSummary,
  resolveEffectiveRules as coreResolveEffectiveRules,
  resolveResourceDecision,
} from './resolveRules.mjs'
import {
  buildViolationFeedback as coreBuildViolationFeedback,
  createDryRunController,
  createInMemoryViolationDb,
} from '../observability/violationLog.mjs'
import { createEffortController } from './effort.mjs'

const DEFAULT_MAX_VIOLATIONS = 100

// Read an OWN property off a possibly-hostile object (a Proxy whose traps throw)
// without ever throwing. OWN-key only (Object.hasOwn) so a polluted Object.prototype
// can't inject an inherited `now`/`maxViolations` — same posture as effort.mjs's
// safeGet for security config.
function safeReadProp(obj, key) {
  try {
    return obj != null && Object.hasOwn(obj, key) ? obj[key] : undefined
  } catch {
    return undefined
  }
}

// A never-throws DEEP copy that NEVER returns the original reference for an object
// (so a later caller mutation can't reach stored state) and whose result's field
// reads never throw (so a hostile throwing getter can't crash the resolution layer
// downstream). structuredClone is the faithful primary path (numbers, nested
// objects, Dates, cycles, BigInt); it throws on functions/symbols, so fall back to a
// JSON round-trip (which also neutralizes a `__proto__` data key into a plain own
// property — no prototype pollution); the manual clone is the last-resort backstop
// for the only inputs both reject (a throwing getter), materializing each own value
// behind a guard and dropping any that throws.
function deepCopy(value) {
  if (value === null) return value
  const t = typeof value
  // A function can't be deep-copied (and a function rule/profile/record is malformed)
  // — drop it rather than retain the original reference (the isolation contract).
  if (t === 'function') return undefined
  if (t !== 'object') return value // primitive → immutable, safe to share as-is
  try {
    return structuredClone(value)
  } catch {
    /* functions/symbols → try JSON */
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    /* throwing getter / unserializable → manual guarded clone */
  }
  // Absolute backstop: manualClone is itself guarded per-field, but wrap it too so
  // NO attack vector (e.g. a throwing array `length` getter on a hostile Proxy) can
  // breach the never-throws contract through a direct deepCopy caller.
  try {
    return manualClone(value, new WeakSet())
  } catch {
    return undefined
  }
}

// Materialize a plain deep copy reading every own value behind a try/catch (a
// throwing getter drops that field rather than escaping). Breaks cycles, never
// sets the prototype via a `__proto__` key, never throws, never shares a reference.
function manualClone(value, seen) {
  if (value === null) return value
  const t = typeof value
  if (t === 'function') return undefined // drop functions rather than share the ref
  if (t !== 'object') return value
  if (seen.has(value)) return undefined // cycle → drop (the first copy already holds it)
  seen.add(value)
  if (Array.isArray(value)) {
    const out = []
    let len = 0
    try {
      // a hostile Proxy can throw on the `length` read — guard it (→ empty array).
      len = value.length >>> 0
    } catch {
      return out
    }
    for (let i = 0; i < len; i++) {
      try {
        out.push(manualClone(value[i], seen))
      } catch {
        out.push(undefined)
      }
    }
    return out
  }
  const out = {}
  let keys
  try {
    keys = Object.keys(value)
  } catch {
    return out
  }
  for (const k of keys) {
    if (k === '__proto__') continue // never poison the prototype
    try {
      out[k] = manualClone(value[k], seen)
    } catch {
      /* throwing getter → drop the field */
    }
  }
  return out
}

// ToolSandboxProfile value vocabularies (types.ts). networkMode is @deprecated/
// advisory only — a profile has NO enforcement effect today.
const VALID_FS_MODES = new Set(['read-only', 'workspace-write', 'no-fs'])
const VALID_NET_MODES = new Set(['allow', 'deny', 'allow-with-restrictions'])

// The non-null default profile for a tool with no stored profile (manager.ts's
// getProfileForTool return type is the non-nullable ToolSandboxProfile).
function defaultProfile(toolName) {
  return { toolName: typeof toolName === 'string' ? toolName : String(toolName), fileSystemMode: 'workspace-write', networkMode: 'allow' }
}

// Keep only the string entries of an array-valued profile field (or undefined). Fully
// guarded — a hostile array (throwing length/index) yields undefined, never a throw.
function sanitizeStringArray(value) {
  try {
    if (!Array.isArray(value)) return undefined
    const out = []
    const len = value.length >>> 0
    for (let i = 0; i < len; i++) {
      const s = value[i]
      if (typeof s === 'string') out.push(s)
    }
    return out.length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

// Coerce arbitrary caller input into a WELL-FORMED ToolSandboxProfile: only the known
// keys, every value validated (invalid/missing → the conservative default), toolName
// from the authoritative Map key. So getProfileForTool ALWAYS returns a valid profile
// regardless of what malformed object/array was passed to setProfileForTool. The
// freshly-built object (primitive strings + new arrays) is inherently isolated.
function normalizeProfile(toolName, profile) {
  const p = profile != null && typeof profile === 'object' ? profile : {}
  const fs = safeReadProp(p, 'fileSystemMode')
  const net = safeReadProp(p, 'networkMode')
  const out = {
    toolName: typeof toolName === 'string' ? toolName : String(toolName),
    fileSystemMode: VALID_FS_MODES.has(fs) ? fs : 'workspace-write',
    networkMode: VALID_NET_MODES.has(net) ? net : 'allow',
  }
  const deny = sanitizeStringArray(safeReadProp(p, 'additionalDenyPatterns'))
  const allow = sanitizeStringArray(safeReadProp(p, 'additionalAllowPatterns'))
  if (deny) out.additionalDenyPatterns = deny
  if (allow) out.additionalAllowPatterns = allow
  return out
}

/**
 * Build the pure state machine behind FortressSandboxManager.
 * @param {{now?: () => number, maxViolations?: number}} [options]
 *   `now` is an injectable clock thunk (default () => Date.now()) — the single
 *   place the clock enters the rule path. `maxViolations` bounds the violation log.
 */
export function createFortressManagerState(options = {}) {
  // Read options through the throw-safe accessor (the bag may be a hostile Proxy).
  const rawNow = safeReadProp(options, 'now')
  const rawMax = safeReadProp(options, 'maxViolations')

  const nowThunk = typeof rawNow === 'function' ? rawNow : null
  // The single clock entry: never throws, always returns a finite number. A throwing
  // or non-finite-returning thunk falls back to the real clock (same class of garbage
  // as a non-function now).
  const now = () => {
    if (nowThunk) {
      try {
        const v = nowThunk()
        if (typeof v === 'number' && Number.isFinite(v)) return v
      } catch {
        /* fall through to the real clock */
      }
    }
    return Date.now()
  }

  const maxViolations = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_VIOLATIONS

  const rulesetsByLayer = new Map()
  const profilesByTool = new Map()
  const dryRun = createDryRunController()
  const effort = createEffortController()
  const violationDb = createInMemoryViolationDb({ maxSize: maxViolations })
  // A bounded SYNC mirror of recent violations: buildViolationFeedback() is sync
  // (the manager interface), but the canonical violationDb is async. recordViolation
  // feeds both — the async DB (deep-cloned canonical audit, swappable for a
  // persistent backend) and this mirror (the sync source for per-turn feedback).
  const recentSync = []

  // The current effective rule corpus (deny-first absolute, expiry-filtered at the
  // clock boundary). Recomputed each call so a setRuleset/effort change is reflected.
  function effective() {
    return coreResolveEffectiveRules(Object.fromEntries(rulesetsByLayer), { now: now() })
  }

  return {
    // ── rulesets (per layer) ──────────────────────────────────────────────
    getRulesetByLayer(layer) {
      // DEEP copies so the public getter never leaks an internal rule reference —
      // a returned rule's nested metadata mutation must not reach stored state.
      return { layer, rules: (rulesetsByLayer.get(layer) ?? []).map(deepCopy) }
    },
    setRuleset(layer, rules) {
      // Only a VALID layer is stored (an invalid bucket would let a rule's own
      // self-declared layer win via resolveEffectiveRules' fallback — keep the
      // bucket authoritative). DEEP copies so a later caller mutation of the input
      // (incl. a rule's nested metadata.expiresAt) cannot flip a stored deny. The
      // map is guarded: a hostile array (a Proxy whose `map`/index traps throw)
      // stores empty rather than crashing (fail-safe — the effort default governs).
      if (!VALID_LAYERS.has(layer)) return
      let copied = []
      try {
        // Array.isArray itself throws on a REVOKED proxy ("IsArray on a revoked
        // proxy"), so it must be inside the guard too, not just the map.
        if (Array.isArray(rules)) copied = rules.map(deepCopy)
      } catch {
        copied = []
      }
      rulesetsByLayer.set(layer, copied)
    },
    resolveEffectiveRules() {
      // DEEP copy on the way OUT: the core shallow-spreads, so its output's nested
      // metadata aliases our stored (deep-copied) metadata — without this a caller
      // mutating a returned rule's metadata.expiresAt could flip a stored deny.
      return effective().map(deepCopy)
    },
    // The composed per-(resource,target) decision: deny-first absolute over the
    // current rules, with the effort/strictness no-match default. The enforcement
    // hook (a later PR) calls this for a concrete file-tool target. Null-safe: a
    // non-object arg defers to the core's own guards (never throws).
    resolveDecision(args) {
      const a = args != null && typeof args === 'object' ? args : {}
      try {
        const result = resolveResourceDecision({
          resource: a.resource, // a throwing getter here is caught below
          target: a.target,
          rules: effective(),
          now: now(),
          defaultDecision: effort.getDefaultDecision(),
        })
        // the matched rule aliases our stored (deep-copied) rule via the core's
        // shallow spread — deep-copy it so the caller can't mutate it back into state.
        return result && result.rule ? { ...result, rule: deepCopy(result.rule) } : result
      } catch {
        // FAIL-SAFE: any unexpected throw (e.g. a hostile throwing getter on the
        // args) resolves to the configured no-match default — never weaker than the
        // policy, never a crash. effort.getDefaultDecision() never throws.
        return { decision: effort.getDefaultDecision(), rule: null, reason: 'error:fail-safe' }
      }
    },

    // ── dry-run ───────────────────────────────────────────────────────────
    enableDryRunMode(enabled) {
      dryRun.enable(enabled)
    },
    isDryRunMode() {
      return dryRun.isEnabled()
    },

    // ── violations ────────────────────────────────────────────────────────
    getViolationDb() {
      return violationDb
    },
    // Record a violation to BOTH the async canonical DB (fire-and-forget) and the
    // sync mirror (bounded, oldest-dropped, DEEP-copied to match the DB's tamper-
    // proofing). A non-object record is ignored. The canonical write is best-effort:
    // a throwing/rejecting backend (the documented swappable path) must not break
    // enforcement, so a sync throw is swallowed and the promise rejection is caught.
    recordFortressViolation(record) {
      try {
        const p = violationDb.recordViolation(record)
        if (p && typeof p.then === 'function') p.then(undefined, () => {})
      } catch {
        /* canonical-DB write is best-effort */
      }
      if (record != null && typeof record === 'object') {
        // Only mirror a USABLE object clone. A malformed record whose deepCopy
        // collapses to undefined (e.g. a revoked proxy) must not occupy a bounded
        // slot — otherwise a flood of malformed records would evict real feedback.
        const copy = deepCopy(record)
        if (copy != null && typeof copy === 'object') {
          recentSync.push(copy)
          if (recentSync.length > maxViolations) recentSync.shift()
        }
      }
    },
    buildViolationFeedback() {
      return coreBuildViolationFeedback(recentSync, { dryRunActive: dryRun.isEnabled() })
    },

    // ── effort / strictness ───────────────────────────────────────────────
    setEffortLevel(level) {
      effort.setEffort(level)
    },
    getCurrentEffort() {
      return effort.getEffort()
    },
    setStrictnessByEffort(mapping) {
      effort.setStrictnessByEffort(mapping)
    },
    // The rule engine's no-match default decision for the current effort/strictness.
    getDefaultDecision() {
      return effort.getDefaultDecision()
    },

    // ── cache-friendly config summary ─────────────────────────────────────
    // {static, dynamic}: static is the byte-stable rule digest (cache-prefix-safe),
    // dynamic is per-call telemetry. NOTE: the wiring MUST keep this OUT of the
    // DeepSeek prompt prefix (it is telemetry/UI only).
    buildCacheFriendlyConfigSummary() {
      return coreBuildCacheFriendlyConfigSummary(effective(), { now: now() })
    },

    // ── per-tool profiles (advisory; no enforcement) ──────────────────────
    getProfileForTool(toolName) {
      // a DEEP copy so a caller mutating the result can't tamper the stored profile.
      const stored = profilesByTool.get(toolName)
      return stored ? deepCopy(stored) : defaultProfile(toolName)
    },
    setProfileForTool(toolName, profile) {
      // Normalize at assignment (type at the source): store a well-formed, validated,
      // freshly-built ToolSandboxProfile so getProfileForTool always round-trips a
      // valid profile — a malformed object/array can never become the stored value.
      profilesByTool.set(toolName, normalizeProfile(toolName, profile))
    },
  }
}
