import { existsSync } from 'node:fs'
import { join } from 'node:path'

// The prune loop records every `ls-files --others` frontier path as "removed"
// BEFORE running `clean`, but `clean -fd` (no -ff) refuses to delete an untracked
// nested git repository, so that path survives on disk yet would be reported as an
// affected/removed file. Reconcile the recorded set against ground truth: keep only
// the paths that `clean` actually deleted (no longer present on disk).
//
// `exists` is injected so the reconciliation is unit-testable without a worktree;
// the production caller passes a workspace-rooted on-disk check. Frontier paths are
// the raw git `-z` bytes (a nested repo is reported as `dir/` with a trailing
// slash); `join` normalizes the trailing slash so the existence check resolves the
// directory itself.
export function reconcileRemovedFiles(candidatePaths, exists) {
  return candidatePaths.filter(path => !exists(path))
}

// Production existence predicate: a frontier path still on disk under the workspace
// root was not removed by `clean`.
export function makeWorkspaceExists(workspaceRoot) {
  return path => existsSync(join(workspaceRoot, path))
}
