// Trust classification of an additionalWorkingDirectory SOURCE for a BODY-sourced
// @-mention read (#580). A pre-written command/skill/plugin/MCP body must not be
// able to read a file that is "in scope" ONLY because a WORKSPACE-controlled
// settings file added its directory: an opened repo controls .claude/settings.json
// (projectSettings) and .claude/settings.local.json (localSettings), so it could
// pad the working-directory set and re-open #580's out-of-workspace read (e.g.
// ship additionalDirectories:["/"] alongside a skill body that at-mentions a home
// secret). Those two WORKSPACE-controlled sources are EXCLUDED here; everything
// else is body-trusted — the workspace root (added by the caller), a `--add-dir`
// / `--settings` flag and managed dirs (stamped 'cliArg' at the apply site), a
// mid-session add ('session'), and the user's global ~/.claude ('userSettings').
//
// Allowlist (fail-secure): an unknown/future source is treated as UNtrusted until
// explicitly added here, so a newly-added settings source can't silently widen a
// body read. The PermissionUpdateDestination enum today is
// {userSettings, projectSettings, localSettings, session, cliArg}.
const BODY_TRUSTED_DIR_SOURCES = new Set(['cliArg', 'session', 'userSettings'])

export function isBodyTrustedDirSource(source) {
  return BODY_TRUSTED_DIR_SOURCES.has(source)
}

// The set of working directories a body-sourced @-mention may read from: the
// workspace root (always trusted) + each additional dir whose source is
// body-trusted. `entries` is the additionalWorkingDirectories.values() list of
// { path, source } objects. A live user-typed @-mention is NOT routed through
// this — it keeps the full additionalWorkingDirectories reach.
export function bodyTrustedWorkingDirSet(workspaceRoot, entries) {
  const dirs = new Set([workspaceRoot])
  for (const entry of entries) {
    if (entry && isBodyTrustedDirSource(entry.source)) {
      dirs.add(entry.path)
    }
  }
  return dirs
}
