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
  // Normalize surrounding whitespace ONCE, before routing. The match side always
  // works on trimmed text — matchWildcardPattern trims the pattern, and both shell
  // tools compare against `input.command.trim()` (bashPermissions / powershell) —
  // but classification ran on the RAW rule content (permissionRuleValueFromString
  // does not trim, and the rule Map is keyed by the raw string). A rule authored
  // with a stray leading/trailing space was therefore mis-routed: the end-anchored
  // extractPrefix regex (`/^(.+):\*$/`) fails to see the `:*` marker on
  // `npm:* `, so it becomes a wildcard `^npm:.*$` that never matches a colon-free
  // `npm install`; and an exact rule like `rm -rf ` can never equal the trimmed
  // command. Either way the rule is SILENTLY inert — and for a deny rule that is a
  // permission bypass. Trimming here makes routing agree with matching. It is
  // safe (strictly re-activating): because the command is ALWAYS trimmed, no rule
  // could ever have matched a real command via surrounding whitespace, so trimming
  // can only revive an otherwise-dead rule, never loosen a working one.
  const trimmed = rule.trim()
  const prefix = extractPrefix(trimmed)

  // Legacy `:*` prefix syntax — but ONLY when the part before `:*` has no
  // unescaped wildcard. `npm:*` / `git status:*` stay prefix; `docker run -v *:*`
  // does not.
  if (prefix !== null && !hasWildcards(prefix)) {
    return { type: 'prefix', prefix }
  }

  // Wildcard if the rule has an unescaped `*` anywhere. hasWildcards(rule) is
  // false for a `:*`-suffixed rule, so the prefix part carries the signal there.
  if (hasWildcards(trimmed) || (prefix !== null && hasWildcards(prefix))) {
    return { type: 'wildcard', pattern: trimmed }
  }

  return { type: 'exact', command: trimmed }
}
