import { lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'

// `checkout-index -f -a` is the only step that materializes snapshot files, and
// `-f` makes it OVERWRITE a path even when a directory currently occupies it —
// recursively bulldozing that directory's whole tree (including an embedded git
// repo and its uncommitted/unpushed work) to write the snapshot's blob.
//
// The pre-flight `ls-files --killed` cleanup is supposed to find every worktree
// path that conflicts by TYPE with a snapshot path, but `--killed`'s directory
// traversal stops at a nested-repo boundary: a directory whose only content is
// an embedded git repo one or more levels below (e.g. `lib/` holding only
// `lib/repo/.git`) is reported by NEITHER `--killed` NOR `--others`, so it is
// invisible to the report yet still bulldozed by `checkout-index -f`. The
// deletion then surfaces in no affectedFiles source and the user is told only
// the snapshot blob path was touched.
//
// Every such conflict — a snapshot blob path occupied by a worktree directory —
// is already present in the `git diff` change set (a blob→directory swap always
// diffs), so we lstat each candidate change path: any that is a real directory
// is a blocking-dir conflict. We `rm -rf` it ourselves — exactly what
// `checkout-index -f` would do, but no longer silently — and record the directory
// path with a trailing slash (git's own `dir/` convention for an untouched-by-
// clean nested repo) so the destroyed tree is surfaced in affectedFiles without
// flooding it with every internal `.git/` object. A symlink-to-a-directory is NOT
// a directory (lstat does not follow it), so it is left for `checkout-index -f`
// to replace in place, never followed into an external target. fs is injectable.
export async function resolveBlockingDirConflicts(
  workspaceRoot,
  candidatePaths,
  deps = {},
) {
  const _lstat = deps.lstat ?? lstat
  const _rm = deps.rm ?? rm

  const removedDirs = []
  for (const relPath of candidatePaths) {
    const absPath = join(workspaceRoot, relPath)
    let stats
    try {
      stats = await _lstat(absPath)
    } catch {
      // Snapshot blob deleted by the turn (ENOENT) — no conflict to clear.
      continue
    }
    if (!stats.isDirectory()) continue

    await _rm(absPath, { recursive: true, force: true })
    removedDirs.push(`${relPath}/`)
  }
  return removedDirs
}
