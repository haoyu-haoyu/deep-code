// parsePermissionRule's routing decision, extracted as a node-testable leaf.
//
// Bug it fixes: the legacy `:*` prefix syntax was checked FIRST and won
// unconditionally, so a rule that ALSO contains an earlier `*` wildcard — e.g.
// `docker run --rm -v *:*` (the natural shape for wildcarding the container side
// of a `-v host:container` mount) or `curl http*:*` — was classified as a literal
// PREFIX (`docker run --rm -v *`). Prefix matching is pure string startsWith, so
// the embedded `*` is matched LITERALLY and the rule (often a deny the user wrote
// to block something) becomes silently inert.
//
// Route such mixed rules to `wildcard` instead. `extractPrefix` and `hasWildcards`
// are injected so they stay typed in shellRuleMatching.ts. Note hasWildcards
// returns false for ANY string ending in `:*` (it treats a trailing `:*` as the
// legacy marker), so the wildcard test must ALSO consult hasWildcards(prefix) —
// the part before `:*` — to detect a mixed rule.
export function classifyPermissionRule(rule, extractPrefix, hasWildcards) {
  const prefix = extractPrefix(rule)

  // Legacy `:*` prefix syntax — but ONLY when the part before `:*` has no
  // unescaped wildcard. `npm:*` / `git status:*` stay prefix; `docker run -v *:*`
  // does not.
  if (prefix !== null && !hasWildcards(prefix)) {
    return { type: 'prefix', prefix }
  }

  // Wildcard if the rule has an unescaped `*` anywhere. hasWildcards(rule) is
  // false for a `:*`-suffixed rule, so the prefix part carries the signal there.
  if (hasWildcards(rule) || (prefix !== null && hasWildcards(prefix))) {
    return { type: 'wildcard', pattern: rule }
  }

  return { type: 'exact', command: rule }
}
