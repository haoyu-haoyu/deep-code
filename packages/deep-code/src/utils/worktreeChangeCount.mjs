// Fail-closed change counter for an EnterWorktree session's worktree.
//
// Returns null when the worktree's state cannot be RELIABLY determined —
// callers that use this as a safety gate before a DESTRUCTIVE
// `git worktree remove --force` MUST treat null as "unknown, assume unsafe"
// and never silently remove. A silent 0/0 on a git error would let
// cleanupWorktree destroy uncommitted work — the exact fail-open this leaf
// exists to prevent. It unifies the fail-closed logic that ExitWorktreeTool
// already had with the WorktreeExitDialog path, which had reimplemented the
// count inline and DROPPED the exit-code checks (a silent force-remove on a
// dirty tree whenever `git status` errored — index.lock contention, corrupt
// index, a failing status hook). Same "inline reimpl diverged from the
// fail-closed sibling" drift class as the recent permission/hook fixes.
//
// null is returned when:
//   - git status or rev-list exits non-zero (index.lock, corrupt index, bad ref)
//   - originalHeadCommit is undefined but status succeeded — the hook-based
//     worktree-wrapping-git case: we can see it is a git tree but have no
//     baseline to count commits, so we cannot prove the branch is clean.
//
// `--no-optional-locks` matches every other status call in the repo
// (getIsClean/getChangedFiles/getFileStatus/context.ts) and is precisely what
// avoids the lock-contention failure that would otherwise trip the fail-closed
// path — so the safety gate stays reliable instead of erroring into "unknown".
//
// execFile is INJECTED (the impure git runner, e.g. execFileNoThrow) so the
// decision logic is pure and node-testable with a fake.
//
// @param {string} worktreePath the worktree directory to inspect
// @param {string|undefined} originalHeadCommit the session's baseline commit
// @param {(cmd: string, args: string[]) => Promise<{ stdout: string, code: number }>} execFile
// @returns {Promise<{ changedFiles: number, commits: number } | null>}
export async function countWorktreeChanges(
  worktreePath,
  originalHeadCommit,
  execFile,
) {
  const status = await execFile('git', [
    '-C',
    worktreePath,
    '--no-optional-locks',
    'status',
    '--porcelain',
  ])
  if (status.code !== 0) return null

  const changedFiles = status.stdout
    .split('\n')
    .filter(line => line.trim() !== '').length

  if (!originalHeadCommit) {
    // git status succeeded → this is a git repo, but without a baseline commit
    // we cannot count commits. Fail-closed rather than claim 0.
    return null
  }

  const revList = await execFile('git', [
    '-C',
    worktreePath,
    'rev-list',
    '--count',
    `${originalHeadCommit}..HEAD`,
  ])
  if (revList.code !== 0) return null

  const commits = parseInt(revList.stdout.trim(), 10) || 0
  return { changedFiles, commits }
}
