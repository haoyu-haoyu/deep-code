// Pure, node-testable projector: effective fortress rules → the OS-enforceable
// filesystem deny list (F3 wiring PR-D). Standalone — nothing imports it until the
// wrapWithSandbox override wires it in, so by itself it keeps dist byte-identical.
//
// THE PROVABLY-SAFE SUBSET. The fortress rule grammar (a glob matcher where a literal
// path is EXACT and `/**` means subtree) and the OS sandbox model (a path is a SUBTREE
// root; macOS compiles globs to a regex with `[]` char-classes + cross-`/` `**`; Linux
// bubblewrap drops globs and skips unbindable paths) genuinely diverge. So we project
// ONLY the intersection where the OS faithfully reproduces the fortress decision — and
// only in the SAFE direction:
//
//   PROJECT: fs-write DENY, ABSOLUTE (starts with '/'), GLOB-FREE after stripping a
//   trailing '/**'. Examples that ARE projected:
//     • '/etc/passwd'  → OS denies that file (a file's subtree is itself) — faithful.
//     • '/etc/secret/**' → the runtime strips the trailing /** and denies the /etc/secret
//       SUBTREE, which is exactly what the fortress '/**' rule matches — faithful.
//     • '/etc' (a directory, no /**) → the runtime denies the /etc SUBTREE. The fortress
//       matcher treats '/etc' as EXACT, so the OS denies a BROADER set — but a broader
//       deny is strictly MORE restrictive (an over-block), NEVER a fail-open. Safe.
//
// NOT PROJECTED (each would otherwise be a silent fail-open / wrong-set, not a true
// deny — surfaced via the unenforced-write warning, left to the per-call file-tool hook
// where the concrete absolute target is known and the fortress matcher applies directly):
//   • fs-write ALLOW → DROPPED. An OS allowWrite is a SUBTREE GRANT, so a fortress
//     'allow /x' (exact) would over-GRANT the whole /x subtree (worst case 'allow /' →
//     the entire tree) — a fail-open. denyWrite wins over allowWrite anyway, so dropping
//     allow loses no deny strength; carve-outs are deferred to the per-call hook.
//   • any glob ('*', '?', '[', ']', mid-'**') → the fortress and OS glob grammars
//     disagree ('[pq]' is a char-class in the OS regex but literal in fortress; mid-'**'
//     crosses '/' in the OS but is whole-segment in fortress), so a projected glob would
//     deny/allow a DIFFERENT set than fortress claims. On Linux bubblewrap drops them.
//   • non-absolute ('./x', 'secrets/**', '~/x', leading-glob '**/.env') → the OS resolves
//     it against process.cwd(), diverging from the fortress matcher's match-anywhere.
//   • fs-read deny/allow → DEFERRED (macOS allowRead wins over denyRead → fail-open).
//   • action 'ask' / net-host / process-exec → not an OS filesystem pattern.
//
// The runtime REPLACES customConfig.filesystem.denyWrite over its base array, so the
// caller (the wrapWithSandbox override) MUST union this delta onto the settings base —
// this core only produces the fortress contribution.

function dedupe(values) {
  return [...new Set(values)]
}

// A pattern the OS sandbox can faithfully enforce without cwd-re-scoping: an absolute
// path. Relative / leading-glob / '~' patterns get resolved against process.cwd() by
// the runtime, diverging from the fortress matcher's match-anywhere semantics.
function isAbsolutePattern(pattern) {
  return typeof pattern === 'string' && pattern.startsWith('/')
}

// True when a pattern still contains an OS glob metacharacter (*, ?, [, ]) AFTER a
// trailing /** is stripped — i.e. a glob the fortress and OS grammars would compile
// differently. The runtime's containsGlobChars(removeTrailingGlobSuffix(p)) is a third
// mirror (external, can't be shared). A trailing /** alone is faithful (the runtime strips
// it to a plain subtree), so it is NOT flagged. Exported as the SINGLE source of truth so
// legacy.ts's getLinuxGlobPatternWarnings shares it — a divergence here would let one path
// warn/project on a glob the other treated as plain (a silent cross-platform skew).
export function hasUnfaithfulGlob(pattern) {
  const stripped = pattern.replace(/\/\*\*$/, '')
  return /[*?[\]]/.test(stripped)
}

// A fs-write DENY pattern is faithfully OS-enforceable iff it is absolute and glob-free
// (after a trailing /** strip). That is the ONLY shape projected.
function isProjectableDeny(pattern) {
  return isAbsolutePattern(pattern) && !hasUnfaithfulGlob(pattern)
}

/**
 * Project an effective (already validated, deny-first, expiry-filtered) fortress rule
 * list into the OS-enforceable filesystem DENY delta. Only fs-write deny rules that are
 * absolute + glob-free are emitted (the provably-safe subset; see the header). Order
 * follows the input (resolveEffectiveRules' canonical total order) so the wrapped
 * command is stable. Defensive: never throws; a malformed rule is skipped.
 * @param {Array<object>} effectiveRules  FortressRule[] from resolveEffectiveRules
 * @returns {{denyWrite: string[]}}
 */
export function fortressRulesToFsDelta(effectiveRules) {
  const denyWrite = []
  if (!Array.isArray(effectiveRules)) return { denyWrite }

  for (const rule of effectiveRules) {
    if (rule == null || typeof rule !== 'object') continue
    let resource
    let action
    let pattern
    try {
      ;({ resource, action, pattern } = rule)
    } catch {
      continue // a throwing getter on a hostile rule object must not break projection
    }
    if (typeof pattern !== 'string' || pattern === '') continue

    // ONLY fs-write deny, absolute + glob-free → a faithful, never-fail-open OS deny.
    if (resource === 'fs-write' && action === 'deny' && isProjectableDeny(pattern)) {
      denyWrite.push(pattern)
    }
    // everything else → not an OS pattern here; surfaced via the warning + per-call hook.
  }

  return { denyWrite: dedupe(denyWrite) }
}

/**
 * True when a projected delta contributes NO filesystem patterns — the signal the
 * wrapWithSandbox override uses to take the byte-identical passthrough path (so a
 * no-fortress-rules session is exactly today's behavior). Defensive: a null/garbage
 * delta counts as empty (fail-safe to passthrough).
 * @param {{denyWrite?: string[]}} delta
 * @returns {boolean}
 */
export function isEmptyFsDelta(delta) {
  if (delta == null || typeof delta !== 'object') return true
  return !(Array.isArray(delta.denyWrite) && delta.denyWrite.length > 0)
}

/**
 * The fortress fs-write DENY rules that are NOT projected to the OS sandbox — i.e. a
 * deny the author expects to enforce but that the SHELL (Bash) path does NOT, on ANY
 * platform (non-absolute, or carrying a glob; the projector emits only absolute
 * glob-free patterns). These ARE still enforced for the file tools (Read/Edit/Write)
 * via the per-call hook, but a shell command writing such a path is unguarded — so the
 * manager surfaces these CROSS-PLATFORM (getFortressUnenforcedWriteWarnings) and the
 * doctor shows them on every platform, so a deny is never SILENTLY treated as enforced.
 * Returned as "fs-write deny <pattern>" lines. Defensive: never throws; only fs-write
 * deny is considered (allow is a non-enforced carve-out).
 * @param {Array<object>} effectiveRules
 * @returns {string[]}
 */
export function fortressUnenforcedWriteWarnings(effectiveRules) {
  const out = []
  if (!Array.isArray(effectiveRules)) return out
  for (const rule of effectiveRules) {
    if (rule == null || typeof rule !== 'object') continue
    let resource
    let action
    let pattern
    try {
      ;({ resource, action, pattern } = rule)
    } catch {
      continue
    }
    if (resource !== 'fs-write' || action !== 'deny') continue
    if (typeof pattern !== 'string' || pattern === '') continue
    if (!isProjectableDeny(pattern)) out.push(`fs-write deny ${pattern}`)
  }
  return out
}
