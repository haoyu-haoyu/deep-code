/**
 * Decide whether a CLAUDE.md/DEEPCODE.md @-import points OUTSIDE the project, so
 * the caller can gate it behind the explicit external-include approval
 * (hasClaudeMdExternalIncludesApproved). An import counts as external if EITHER
 * its lexical (path-resolved) location OR its symlink-resolved real location
 * lies outside the project.
 *
 * The lexical-only check was bypassable: a committed symlink whose OWN path is
 * in-project (e.g. `link.md` -> `/etc/passwd`) passed pathInOriginalCwd on the
 * lexical path, then the recursive read followed the symlink and loaded the
 * external target into the model context — silently defeating the approval gate.
 * Resolving the symlink before the containment check closes that TOCTOU.
 *
 * Safe failure: when the real path can't be resolved (broken/ENOENT symlink),
 * the caller passes the lexical path back as resolvedRealPath, so this reduces
 * to the original lexical-only check (no new false-positive, no read of a target
 * that doesn't resolve).
 *
 * @param {string} lexicalPath  the path-resolved (non-symlink-followed) import path
 * @param {string} resolvedRealPath  safeResolvePath(...).resolvedPath for lexicalPath
 * @param {(p: string) => boolean} isInsideProject  pathInOriginalCwd
 * @returns {boolean} true if the import must be treated as external
 */
export function importIsExternal(lexicalPath, resolvedRealPath, isInsideProject) {
  if (!isInsideProject(lexicalPath)) return true
  return symlinkEscapesProject(lexicalPath, resolvedRealPath, isInsideProject)
}

/**
 * True when a file whose LEXICAL path is inside the project resolves (via a
 * symlink) to a real path OUTSIDE the project. This is the narrower predicate
 * for guarding a directly-discovered file (the top-level DEEPCODE.md/CLAUDE.md
 * or a .deepcode/rules/*.md entry), where the lexical path is an in-project,
 * legitimately-discovered location but the file on disk is a symlink to an
 * external target — the same committed-symlink bypass as in an @-import.
 *
 * Unlike {@link importIsExternal}, this does NOT flag a file whose lexical path
 * is ALREADY outside the project (e.g. a --add-dir directory, or User/Managed
 * memory in the home/managed dir). Those are loaded on purpose; only an
 * in-project path that escapes via a symlink is the bypass.
 *
 * @param {string} lexicalPath
 * @param {string} resolvedRealPath
 * @param {(p: string) => boolean} isInsideProject
 * @returns {boolean}
 */
export function symlinkEscapesProject(lexicalPath, resolvedRealPath, isInsideProject) {
  return (
    isInsideProject(lexicalPath) &&
    !!resolvedRealPath &&
    resolvedRealPath !== lexicalPath &&
    !isInsideProject(resolvedRealPath)
  )
}
