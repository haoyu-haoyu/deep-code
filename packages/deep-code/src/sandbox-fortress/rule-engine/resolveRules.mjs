// Pure, node-testable Layer-3 rule-RESOLUTION core for the Sandbox Fortress (F3).
//
// This is the standalone decision logic behind FortressSandboxManager's
// getRulesetByLayer/setRuleset/resolveEffectiveRules/buildCacheFriendlyConfigSummary
// (manager.ts) — implemented here as a pure .mjs so it is node --test-able and
// has ZERO coupling to the live runtime. It is NOT wired into enforcement yet (a
// later PR does that), so it cannot affect the byte-identical DeepSeek default
// request / prefix-cache moat.
//
// DESIGN: DENY-FIRST, ABSOLUTE — consistent with networkDecision.mjs's
// deny-before-allow, where deny always wins. Any matching deny BLOCKS; no allow
// (of any layer) overrides it. This is the provably-safe model: there is NO
// fail-open path. No-match defaults to 'ask' (defer to the host, like
// resolveNetworkDecision), never 'allow'; a `defaultDecision` option lets a later
// strictness/effort PR flip non-interactive/paranoid contexts to 'deny'.
//
// A design judge-panel originally proposed a trust-gated "escape hatch" (a
// strictly-higher-layer, more-specific allow carving a narrow exception out of a
// broad deny). It is DEFERRED: it cannot be gated safely by a count-based
// specificity metric — coverage fuzzing found fail-opens where a single broad
// `allow /**` (one wildcard token) out-ranks a more-tokened but narrower deny and
// nukes it. A correct override needs true glob match-set CONTAINMENT (allow ⊆
// deny), a separate design (tracked with the wiring PR + the locked/floor-layer
// open question). Until then every deny is a hard floor at every layer.
//
// Layer trust order (README "BuiltinDefault < Org < Agent < User"): higher rank =
// more authoritative. It is used only for deterministic PROVENANCE (which deny/
// allow/ask rule is reported) and the digest sort — not to override a deny.
//
// FAIL-SAFE like networkDecision.mjs: never throws on any input, never mutates
// inputs, a malformed/empty pattern matches NOTHING (neither a spurious allow nor
// deny). `now` is always an explicit parameter; this core NEVER calls Date.now()
// (deterministic / frozen-clock testable) — when `now` is omitted, expiry
// filtering is skipped entirely.

import { matchesDomainPattern } from '../networkDecision.mjs'

// ── exported constants (single source of truth; manager.ts + tests import these) ─

/** Layer trust rank — higher = more authoritative. */
export const LAYER_RANK = Object.freeze({
  'builtin-default': 0,
  org: 1,
  agent: 2,
  user: 3,
})

/** Action rank for the STATIC digest's stable sort tiebreak ONLY (deny<allow<ask).
 * The DECISION is deny-first by construction, NOT by this rank. */
export const ACTION_RANK = Object.freeze({ deny: 0, allow: 1, ask: 2 })

export const VALID_LAYERS = new Set(Object.keys(LAYER_RANK))
export const VALID_ACTIONS = new Set(['allow', 'deny', 'ask'])
export const VALID_RESOURCES = new Set(['fs-read', 'fs-write', 'net-host', 'process-exec'])

const PATH_RESOURCES = new Set(['fs-read', 'fs-write', 'process-exec'])

// ── (3) pattern matcher + specificity ───────────────────────────────────────

// fs/process glob matching is done WITHOUT a regex — a segment-aware, classic
// linear wildcard matcher — so there is no catastrophic backtracking (ReDoS) on
// adversarial patterns like `/**/**/.../x`, and so every literal char (`.` `[`
// `(` `|` `$` `\` …) is matched literally with NO chance of regex injection.
//
// Grammar: `?` = one non-'/' char; `*` = a run of non-'/' chars (within ONE
// segment); a WHOLE segment of `**` = a globstar matching ZERO-OR-MORE segments
// (so a trailing `/**` matches the prefix dir itself: `/a/**` matches `/a`,
// `/a/b`, `/a/b/c`). A `*`/`**` mixed INTO a segment (`a**b`) acts as `*` (no
// '/' inside a segment, so `*` and `**` match the same set there).

// Match one path segment (no '/') against a within-segment pattern (`*`, `?`,
// literals). Classic two-pointer wildcard match — O(n·m) worst case, never
// exponential. Runs of `*` are equivalent to one (collapsed by the caller).
function matchWithinSegment(pat, str) {
  let p = 0
  let s = 0
  let star = -1
  let sBack = 0
  while (s < str.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === str[s])) {
      p++
      s++
    } else if (p < pat.length && pat[p] === '*') {
      star = p
      sBack = s
      p++
    } else if (star !== -1) {
      p = star + 1
      s = ++sBack
    } else {
      return false
    }
  }
  while (p < pat.length && pat[p] === '*') p++
  return p === pat.length
}

// Within a segment, `*`/`**`/`***` all mean "any run of non-'/' chars" → collapse
// to a single `*` so matchWithinSegment sees one star token.
function collapseStars(seg) {
  return seg.replace(/\*+/g, '*')
}

// Match a full path against an fs/process glob, segment by segment, with a
// whole-segment `**` as a zero-or-more-segments globstar. Classic linear wildcard
// match at the segment level — O(P·T) worst case, NEVER exponential.
function globMatch(pattern, target) {
  const pSegs = pattern.split('/')
  const tSegs = target.split('/')
  let p = 0
  let t = 0
  let star = -1
  let tBack = 0
  while (t < tSegs.length) {
    if (p < pSegs.length && pSegs[p] !== '**' && matchWithinSegment(collapseStars(pSegs[p]), tSegs[t])) {
      p++
      t++
    } else if (p < pSegs.length && pSegs[p] === '**') {
      star = p
      tBack = t
      p++
    } else if (star !== -1) {
      p = star + 1
      t = ++tBack
    } else {
      return false
    }
  }
  while (p < pSegs.length && pSegs[p] === '**') p++
  return p === pSegs.length
}

// Count the `*`/`?` glob tokens (`**` counts as ONE).
function countWildcards(pattern) {
  const m = pattern.match(/\*\*|\*|\?/g)
  return m ? m.length : 0
}

// Count literal (non-glob) chars: everything that is not a `*` or `?`.
function countLiterals(pattern) {
  return pattern.replace(/[*?]/g, '').length
}

// Count pattern "segments": path segments split on '/' (host labels split on '.'
// for net-host). A trailing `/**` or a bare `**` contributes 0 segments.
function countSegments(resource, pattern) {
  if (pattern === '**') return 0
  const sep = resource === 'net-host' ? '.' : '/'
  const p = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
  return p.split(sep).filter(s => s.length > 0).length
}

/**
 * Parse a pattern into validity + specificity metrics. Fail-safe: a non-string/
 * empty pattern or an unknown resource → {ok:false}. Matching is done by globMatch
 * (fs/process) or matchesDomainPattern (net-host), not by a regex.
 * @param {string} resource
 * @param {string} pattern
 * @returns {{ok:true, literalCount:number, segmentCount:number, length:number, wildcardCount:number}|{ok:false}}
 */
export function parsePattern(resource, pattern) {
  if (typeof pattern !== 'string' || pattern === '') return { ok: false }
  if (resource !== 'net-host' && !PATH_RESOURCES.has(resource)) return { ok: false }
  return {
    ok: true,
    literalCount: countLiterals(pattern),
    segmentCount: countSegments(resource, pattern),
    length: pattern.length,
    wildcardCount: countWildcards(pattern),
  }
}

/**
 * Comparable specificity tuple — bigger tuple = MORE specific. A malformed pattern
 * yields the least sentinel so it never wins an escape-hatch comparison or a sort.
 *
 * Order is [-wildcardCount, literalCount, segmentCount, length] — the WILDCARD
 * count is PRIMARY. This is the security-load-bearing choice: a pattern with MORE
 * wildcards is BROADER (matches a superset), so it must rank LESS specific no
 * matter how many literal chars its path prefix adds. Otherwise a broad allow like
 * `/x/**` (whose extra `/x/` literal would outweigh a precise `/x` deny if
 * literalCount came first) could escape-hatch a narrower deny — a fail-open. With
 * wildcard-count primary, an allow can override a deny ONLY when it has
 * fewer-or-equal wildcards (i.e. is no broader); among equal-wildcard patterns
 * more literals / segments win; length is the final total-order tiebreak.
 * @returns {[number, number, number, number]} [-wildcardCount, literalCount, segmentCount, length]
 */
export function patternSpecificity(resource, pattern) {
  const p = parsePattern(resource, pattern)
  if (!p.ok) return [-1, -1, -1, -1]
  return [-p.wildcardCount, p.literalCount, p.segmentCount, p.length]
}

// Lexicographic compare of two specificity tuples; >0 means `a` is more specific.
function compareSpecificity(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}


/**
 * Does `target` match `pattern` under `resource`'s grammar? net-host delegates to
 * matchesDomainPattern (REUSE — `*.host` matches subdomains, case-insensitive);
 * fs/process use the non-backtracking segment globber (globMatch). Malformed/empty
 * pattern OR an empty/non-string target → false. Unknown resource → false. Never throws.
 * @param {string} resource
 * @param {string} pattern
 * @param {string} target
 * @returns {boolean}
 */
export function patternMatches(resource, pattern, target) {
  if (resource === 'net-host') return matchesDomainPattern(target, pattern)
  if (!PATH_RESOURCES.has(resource)) return false
  if (typeof pattern !== 'string' || pattern === '') return false
  // An empty/non-string target is a degenerate, meaningless access — never a
  // match (closes the `/**` ~ '' over-match). The wiring passes resolved paths.
  if (typeof target !== 'string' || target === '') return false
  try {
    return globMatch(pattern, target)
  } catch {
    return false
  }
}

// ── (1) merge / validate / expire / dedupe / canonical-order ────────────────

function isValidRule(rule) {
  return (
    rule != null &&
    typeof rule === 'object' &&
    VALID_RESOURCES.has(rule.resource) &&
    VALID_ACTIONS.has(rule.action) &&
    typeof rule.pattern === 'string' &&
    rule.pattern !== '' &&
    VALID_LAYERS.has(rule.layer)
  )
}

// Normalize the dedupe/digest form of a pattern: net-host is case-insensitive
// (mirrors matchesDomainPattern), everything else is verbatim.
function normPattern(resource, pattern) {
  return resource === 'net-host' ? pattern.toLowerCase() : pattern
}

// Resolve a rule's authoritative layer. SECURITY: the BUCKET (the Record key or
// the FortressRuleset.layer the rule was placed under) is the trust assignment and
// WINS — a rule's own `layer` field is only a fallback when the bucket has no
// valid layer. Otherwise a low-trust source that controls a rule object could
// self-declare `layer:'user'` inside the builtin/org bucket and be silently
// elevated, bypassing the entire deny-sticky trust model (an escape-hatch
// fail-open). The rule's own `layer` is overwritten with the bucket's.
function resolveRuleLayer(rule, bucketLayer) {
  if (VALID_LAYERS.has(bucketLayer)) return bucketLayer
  if (rule && VALID_LAYERS.has(rule.layer)) return rule.layer
  return undefined
}

// Flatten any accepted input shape into [{rule, bucketLayer}] WITHOUT validating.
function* iterRawRules(rulesByLayer) {
  if (Array.isArray(rulesByLayer)) {
    for (const bucket of rulesByLayer) {
      if (!bucket || typeof bucket !== 'object') continue
      const bucketLayer = bucket.layer
      const rules = bucket.rules
      if (!Array.isArray(rules)) continue
      for (const rule of rules) yield { rule, bucketLayer }
    }
    return
  }
  if (rulesByLayer && typeof rulesByLayer === 'object') {
    for (const bucketLayer of Object.keys(rulesByLayer)) {
      const rules = rulesByLayer[bucketLayer]
      if (!Array.isArray(rules)) continue
      for (const rule of rules) yield { rule, bucketLayer }
    }
  }
}

function isExpired(rule, now) {
  if (now === undefined) return false
  const exp = rule?.metadata?.expiresAt
  // only a FINITE numeric expiry in the past closes the window (inclusive);
  // absent/NaN/Infinity → never expires (malformed metadata must not silently
  // delete a security rule).
  return typeof exp === 'number' && Number.isFinite(exp) && exp <= now
}

/**
 * Merge the per-layer rulesets into ONE effective, validated, non-expired,
 * de-duplicated, canonically-ordered rule list. The order is a TOTAL order so the
 * output is byte-identical run-to-run and input-order-independent (the cache-moat
 * requirement). Accepts a Partial<Record<RulesetLayer,FortressRule[]>>, a
 * FortressRuleset[], or a {layer,rules}[]. Never throws, never mutates input.
 * @param {object} rulesByLayer
 * @param {{now?:number}} [options]
 * @returns {Array<object>} new FortressRule[] (the rule's `layer` is the resolved authoritative layer)
 */
export function resolveEffectiveRules(rulesByLayer, options = {}) {
  const now = options?.now
  // Group by canonical key (layer/resource/action/normPattern) in a Map — so dedupe
  // is correct regardless of input order or net-host case (no reliance on sort
  // adjacency). For each key keep the DETERMINISTIC representative: the minimum
  // under compareRulesForDigest (a STRICT total order incl. raw pattern + all
  // metadata), so WHICH duplicate's metadata survives never depends on input order.
  const groups = new Map()
  for (const { rule, bucketLayer } of iterRawRules(rulesByLayer)) {
    const layer = resolveRuleLayer(rule, bucketLayer)
    if (layer === undefined) continue
    // A copy is made (layer normalized) so we never mutate the caller's object.
    const candidate =
      rule && typeof rule === 'object' ? { ...rule, layer } : rule
    if (!isValidRule(candidate)) continue
    if (isExpired(candidate, now)) continue
    const key = `${candidate.layer}|${candidate.resource}|${candidate.action}|${normPattern(candidate.resource, candidate.pattern)}`
    const existing = groups.get(key)
    if (existing === undefined || compareRulesForDigest(candidate, existing) < 0) {
      groups.set(key, candidate)
    }
  }
  return [...groups.values()].sort(compareRulesForDigest)
}

// A deterministic, total-order tail key for a rule: the canonical pattern, then
// the RAW pattern (so net-host case variants order deterministically), then ALL
// metadata serialized with SORTED keys. This makes compareRulesForDigest a STRICT
// total order over ANY metadata difference (reason/expiresAt/sourceFile/… — not
// just sourceFile/sourceLine), so the dedupe survivor + provenance are
// input-order-independent for every canonical-duplicate shape.
function ruleTotalOrderTail(r) {
  const np = normPattern(r.resource, r.pattern)
  const meta = r.metadata && typeof r.metadata === 'object'
    ? Object.keys(r.metadata)
        .sort()
        .map(k => `${k}=${String(r.metadata[k])}`)
        .join(',')
    : ''
  return `${np}${r.pattern}${meta}`
}

// Total order for the canonical digest: resource ASC, action-rank ASC
// (deny<allow<ask), layer-rank DESC, specificity DESC, then ruleTotalOrderTail ASC
// — which orders by the CANONICAL (net-host-case-folded) pattern FIRST so
// canonical duplicates sort ADJACENT (a requirement for the adjacent-dedupe), then
// by raw pattern + full metadata for a strict total order (no two non-identical
// rules compare equal → byte-stable digest + deterministic survivor).
function compareRulesForDigest(a, b) {
  if (a.resource !== b.resource) return a.resource < b.resource ? -1 : 1
  const ar = ACTION_RANK[a.action] - ACTION_RANK[b.action]
  if (ar !== 0) return ar
  const lr = LAYER_RANK[b.layer] - LAYER_RANK[a.layer] // DESC
  if (lr !== 0) return lr
  const sp = compareSpecificity(
    patternSpecificity(b.resource, b.pattern),
    patternSpecificity(a.resource, a.pattern),
  ) // DESC (more specific first)
  if (sp !== 0) return sp
  const ta = ruleTotalOrderTail(a)
  const tb = ruleTotalOrderTail(b)
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

// ── (2) per-target decision (deny-first, absolute) ──────────────────────────

// The most authoritative + specific rule to REPORT for provenance. Candidates
// share a resource + action, so compareRulesForDigest's total order reduces to
// (layer DESC, specificity DESC, pattern ASC, sourceFile ASC, sourceLine ASC) —
// a STRICT total order. Pick its minimum so the reported rule is deterministic
// even when two candidates are canonically identical but differ in metadata
// (which the caller may pass un-deduped).
function mostAuthoritativeMostSpecific(list) {
  let best = null
  for (const r of list) {
    if (best === null || compareRulesForDigest(r, best) < 0) best = r
  }
  return best
}

const DEFAULT_DECISIONS = new Set(['ask', 'deny'])

/**
 * Resolve the effective action for ONE concrete access. Order-independent (works
 * on a raw OR pre-sorted rule list). Never throws — bad args fall through to the
 * default.
 * @param {{resource:string, target:string, rules:Array<object>, now?:number, defaultDecision?:('ask'|'deny')}} args
 * @returns {{decision:('allow'|'deny'|'ask'), rule:object|null, reason:string}}
 */
export function resolveResourceDecision(rawArgs) {
  // null-safe: `= {}` only catches undefined, not null/non-object — guard so any
  // garbage arg falls through to the default rather than throwing (fail-safe).
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  const { resource, target, rules, now } = args
  const defaultDecision = DEFAULT_DECISIONS.has(args.defaultDecision)
    ? args.defaultDecision
    : 'ask'

  // Step 0: candidates = same-resource, non-expired, pattern-matching rules.
  const deny = []
  const allow = []
  const ask = []
  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (!isValidRule(r)) continue
      if (r.resource !== resource) continue
      if (isExpired(r, now)) continue
      if (!patternMatches(resource, r.pattern, target)) continue
      if (r.action === 'deny') deny.push(r)
      else if (r.action === 'allow') allow.push(r)
      else ask.push(r)
    }
  }

  // Step 2: DENY-FIRST, ABSOLUTE. Any matching deny blocks — a higher-layer allow
  // does NOT override it. This is consistent with networkDecision.mjs (deny always
  // wins) and is the provably-safe choice: there is no fail-open path.
  //
  // NOTE: a trust-gated "escape hatch" (a strictly-higher-layer allow carving a
  // narrow exception out of a broad deny) is DEFERRED. It cannot be gated safely by
  // a count-based specificity metric — e.g. a single broad `allow /**` (one
  // wildcard token) would out-rank a more-tokened but narrower deny, nuking it (a
  // fail-open empirically found by coverage fuzzing). A correct override needs true
  // glob match-set CONTAINMENT (allow ⊆ deny), which is a separate design (see the
  // wiring PR + open-question on locked/floor layers). Until then deny is a hard
  // floor for every layer. The deny reported is the most authoritative + specific.
  if (deny.length > 0) {
    return { decision: 'deny', rule: mostAuthoritativeMostSpecific(deny), reason: 'deny:absolute' }
  }

  // Step 3: a positive allow outranks ask.
  if (allow.length > 0) {
    return { decision: 'allow', rule: mostAuthoritativeMostSpecific(allow), reason: 'allow:plain' }
  }

  // Step 4: only ask matched.
  if (ask.length > 0) {
    return { decision: 'ask', rule: mostAuthoritativeMostSpecific(ask), reason: 'ask:rule' }
  }

  // Step 5: nothing matched → the configured default.
  return { decision: defaultDecision, rule: null, reason: `no-match:${defaultDecision}` }
}

/** Convenience: just the resolved verb. @returns {('allow'|'deny'|'ask')} */
export function resolveResourceAction(args) {
  return resolveResourceDecision(args).decision
}

// ── (4) cache-friendly config summary ───────────────────────────────────────

/**
 * Split the effective ruleset into {static, dynamic}. `static` MAY enter a cached
 * prompt prefix — it is byte-identical turn-over-turn while the rule SET is
 * unchanged (decision-relevant fields ONLY, in the resolveEffectiveRules order),
 * so it never collapses the DeepSeek prefix cache via a timestamp. `dynamic`
 * (telemetry/UI) NEVER enters a cached prefix and may change every call.
 * @param {Array<object>} effectiveRules  already sorted by resolveEffectiveRules
 * @param {{now?:number}} [options]
 * @returns {{static:string, dynamic:string}}
 */
export function buildCacheFriendlyConfigSummary(effectiveRules, options = {}) {
  const rules = Array.isArray(effectiveRules) ? effectiveRules.filter(isValidRule) : []
  const now = options?.now

  const staticLines = ['rsv1']
  for (const r of rules) {
    staticLines.push(`${r.resource}|${r.layer}|${r.action}|${normPattern(r.resource, r.pattern)}`)
  }

  const byResource = {}
  const byLayer = {}
  let soonestExpiry = null
  for (const r of rules) {
    byResource[r.resource] = (byResource[r.resource] ?? 0) + 1
    byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1
    const exp = r.metadata?.expiresAt
    if (typeof exp === 'number' && Number.isFinite(exp)) {
      if (now === undefined || exp > now) {
        if (soonestExpiry === null || exp < soonestExpiry) soonestExpiry = exp
      }
    }
  }

  return {
    static: staticLines.join('\n'),
    dynamic: JSON.stringify({
      generatedAt: now ?? null,
      totalRules: rules.length,
      byResource,
      byLayer,
      soonestExpiry,
    }),
  }
}
