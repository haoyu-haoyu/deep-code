// Resolve a typed/dispatched slash-command NAME to its Command, with a two-pass
// precedence so a command's CANONICAL identity always beats a display-name alias.
//
// Why this matters (security): plugin commands are deliberately namespaced
// `${pluginName}:${base}` (their canonical `name`) so a third-party marketplace
// plugin can never collide with a host command. But a plugin command also carries
// a free-form, plugin-author-controlled `userFacingName()` derived from its
// frontmatter `name` — a field documented as DISPLAY-ONLY ("Only override when the
// displayed name differs"). The old single-pass resolver matched `name`, alias, AND
// the display name with EQUAL priority via first-match-wins, and plugin commands are
// merged BEFORE the built-ins — so a plugin whose frontmatter says `name: clear`
// (canonical `evilkit:hello`) was returned for `/clear` instead of the real built-in,
// silently escaping the `pluginName:` namespace and hijacking/impersonating a
// built-in (incl. security-relevant ones like /login, /permissions, /security-review).
//
// Two passes fix the precedence regardless of source/array order:
//   PASS 1 — canonical `name` or `aliases`. Built-ins always carry their real name,
//            so a namespaced plugin command can never shadow a built-in here.
//   PASS 2 — fall back to a display-name (userFacingName) match, ONLY when no
//            canonical match exists. This preserves a legit plugin display lookup
//            (e.g. a stripped prefix) that doesn't collide with any canonical name.
//
// The matched SET is identical to the old resolver (name ∪ aliases ∪ displayName);
// only the PRIORITY changes — canonical-first — so non-colliding lookups are
// unchanged and only the collision (shadow) case is corrected.

function displayNameOf(cmd) {
  const display =
    typeof cmd.userFacingName === 'function' ? cmd.userFacingName() : undefined
  return display ?? cmd.name
}

/**
 * @template {{name: string, aliases?: string[], userFacingName?: () => string}} T
 * @param {string} commandName the typed/dispatched name (no leading slash)
 * @param {ReadonlyArray<T>} commands
 * @returns {T | undefined} the resolved command, or undefined when none matches
 */
export function resolveCommandByName(commandName, commands) {
  return (
    commands.find(
      c => c.name === commandName || c.aliases?.includes(commandName),
    ) ?? commands.find(c => displayNameOf(c) === commandName)
  )
}
