// Pure predicate for deciding whether a saved session belongs to a given
// workspace, used to filter cross-project leakage when two distinct workspaces
// collide onto one project directory.
//
// Why this is needed: project dirs are named by sanitizePath, which folds every
// non-alphanumeric character to '-' and (for paths <= 200 chars) appends NO
// hash. So distinct short workspaces map to the SAME exact directory —
// `/a/my-app`, `/a/my_app`, and `/a/my.app` all become `-a-my-app`. Their
// sessions then share one store, and a /resume or `session list` in one shows
// the other's sessions (resumable in the wrong cwd). Sibling worktree dirs cross
// match the same way (`-code-myrepo` is a prefix of `-code-myrepo-docs`). The
// directory layout can't change without orphaning every existing store, so the
// fix is to filter at read time using each session's OWN recorded cwd.
//
// Both inputs are expected to be realpath + NFC canonicalized by the caller
// (mirroring the writer's canonicalizeDir), so a symlinked workspace
// (/tmp -> /private/tmp) still matches and keeps showing.

/**
 * Normalize an already-canonicalized path for identity comparison: trim trailing
 * separators (never reducing a root to empty), and on Windows fold case and
 * unify separators (its filesystem is case-insensitive and accepts both).
 *
 * @param {unknown} p
 * @param {string} platform
 * @returns {string} the normalized path, or '' when not a usable string
 */
function normalizeForCompare(p, platform) {
  if (typeof p !== 'string' || p.length === 0) return ''
  let s = platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p
  // Trim trailing '/' but keep at least the first character (so '/' stays '/').
  let end = s.length
  while (end > 1 && s[end - 1] === '/') end--
  return s.slice(0, end)
}

/**
 * Does a session recorded at `sessionCwd` belong to the workspace rooted at
 * `workspaceRoot`?
 *
 * FAIL-OPEN: returns true when either side is empty/absent — a pre-cwd legacy
 * session, or a listing with no known workspace, must keep showing. We only
 * return false when we are CONFIDENT the session is foreign (both paths present
 * and the session is neither equal to nor nested under the workspace root).
 *
 * @param {unknown} sessionCwd the session's own recorded (canonicalized) cwd
 * @param {unknown} workspaceRoot the (canonicalized) workspace being listed
 * @param {{ platform?: string }} [opts]
 * @returns {boolean}
 */
export function sessionBelongsToWorkspace(
  sessionCwd,
  workspaceRoot,
  { platform = process.platform } = {},
) {
  const session = normalizeForCompare(sessionCwd, platform)
  const root = normalizeForCompare(workspaceRoot, platform)
  if (!session || !root) return true
  if (session === root) return true
  // The session ran in a subdirectory of the workspace root. When the root IS
  // the filesystem root ('/'), normalizeForCompare keeps the trailing '/', so
  // don't append a second one (every absolute path is then nested under '/').
  const boundary = root.endsWith('/') ? root : root + '/'
  return session.startsWith(boundary)
}
