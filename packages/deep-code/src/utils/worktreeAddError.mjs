// Classify a `git worktree add` stderr as a STALE-registration conflict that
// `git worktree prune` can clear — so the add is worth one prune+retry.
//
// `git worktree prune` drops administrative registrations whose working-tree
// directory is gone (and is a no-op on live worktrees). Two stale-registration
// fatals are recoverable by it — BOTH are load-bearing for the dir-gone wedge:
//   - "'<branch>' is already used by worktree at '<path>'"
//     This is what actually fires in getOrCreateWorktree's flow: the re-create
//     uses the SAME deterministic path AND the SAME branch as the vanished
//     worktree, so git reports the branch conflict first. fast-resume returned
//     null (dir gone) → `git worktree add -B <branch> <path>` fatals (exit 128),
//     permanently wedging this slug until pruned.
//   - "'<path>' is a missing but already registered worktree"
//     Fires when only the PATH (not the branch) is the stale registration (e.g.
//     a fresh branch name). Same dir-gone cause, same prune+retry recovery.
//   In both, prune frees the registration iff the offending worktree's dir is
//   also gone; if a LIVE worktree still holds the path/branch, the retry fails
//   again and the caller surfaces the error (we never steal from a live worktree).
//
// Deliberately NOT matched: "'<path>' already exists" — a real directory is
// present there, which prune cannot fix and which must not be auto-deleted (it
// could hold user files). Verified against real git output (git 2.x).
//
// @param {string | undefined | null} stderr
// @returns {boolean}
export function isStaleWorktreeRegistrationError(stderr) {
  const s = stderr ?? ''
  return (
    /is a missing but already registered worktree/.test(s) ||
    /is already used by worktree at /.test(s)
  )
}
