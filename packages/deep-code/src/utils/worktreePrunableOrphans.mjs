// Parse `git worktree list --porcelain` and return the registrations that are
// (a) PRUNABLE — git reports the working-tree directory is gone — AND (b) one of
// OUR ephemeral agent/workflow worktrees. The readdir-driven stale sweep only
// iterates directories that still EXIST, so a worktree whose dir was deleted out
// from under git (crash, manual `rm -rf`, lost mount) is never found there — it
// leaks both its `.git/worktrees/<slug>` admin entry and its `worktree-<slug>`
// branch. This is the registry-side counterpart that finds them.
//
// Pure: the ephemeral-slug predicate is injected so EPHEMERAL_WORKTREE_PATTERNS
// stays the single source of truth in worktree.ts. `locked` registrations are
// excluded — git refuses to prune a locked worktree, and we must never
// force-delete a locked worktree's branch. `branch` is null for a detached HEAD
// (nothing to `git branch -D`; pruning the registration is the whole cleanup).
//
// Porcelain v1 format: blank-line-separated blocks, each a set of
// `<keyword> [value]` lines (`worktree <path>`, `HEAD <sha>`, `branch <ref>`,
// `bare`, `detached`, `locked [reason]`, `prunable [reason]`). Git emits the
// worktree path with forward slashes even on Windows.
//
// @param {string} porcelainStdout  raw `git worktree list --porcelain` output
// @param {(slug: string) => boolean} isEphemeralSlug
// @returns {Array<{ path: string, slug: string, branch: string | null }>}
export function parsePrunableEphemeralOrphans(porcelainStdout, isEphemeralSlug) {
  const orphans = []
  const blocks = String(porcelainStdout ?? '').split(/\r?\n\r?\n/)
  for (const block of blocks) {
    let path = null
    let branch = null
    let prunable = false
    let locked = false
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length)
        branch = ref.startsWith('refs/heads/')
          ? ref.slice('refs/heads/'.length)
          : ref
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        prunable = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true
      }
    }
    if (!path || !prunable || locked) continue
    const slug = path.split(/[/\\]/).filter(Boolean).pop() ?? ''
    if (!slug || !isEphemeralSlug(slug)) continue
    orphans.push({ path, slug, branch })
  }
  return orphans
}
