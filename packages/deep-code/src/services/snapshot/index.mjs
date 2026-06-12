import { checkAndPrune } from './diskCap.mjs'
import { acquireLock } from './lock.mjs'
import { appendManifest, readManifest } from './manifest.mjs'
import {
  computeWorkspaceHash,
  normalizeWorkspaceRoot,
  resolveSnapshotStore,
  SNAPSHOT_HASH_VERSION,
} from './paths.mjs'
import { initializeSideGit, runSideGit } from './storeInit.mjs'

export {
  computeWorkspaceHash,
  resolveSnapshotStore,
  SNAPSHOT_HASH_VERSION,
} from './paths.mjs'

export async function createSnapshot({ workspaceRoot, turnId, phase }) {
  validateSnapshotPhase(phase)
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  const store = resolveSnapshotStore({ workspaceRoot: normalizedWorkspaceRoot })
  const lock = await acquireLock({ workspaceRoot: normalizedWorkspaceRoot })
  try {
    await initializeSideGit(store.gitDir, normalizedWorkspaceRoot)
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'add',
      '-A',
      '--',
      '.',
    ])
    const treeSha = (
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, ['write-tree'])
    ).trim()
    const commitSha = (
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'commit-tree',
        treeSha,
        '-m',
        `turn-${String(turnId)}-${phase}`,
      ])
    ).trim()
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'update-ref',
      snapshotRefForCommit(commitSha),
      commitSha,
    ])
    const previousEntries = await readManifest(store.manifestPath)
    const previousCommitSha = previousEntries.at(-1)?.commitSha
    const changedFiles = await listCommitFiles(
      store.gitDir,
      normalizedWorkspaceRoot,
      commitSha,
      previousCommitSha,
    )

    const entry = {
      turnId,
      phase,
      timestamp: Date.now(),
      commitSha,
      workspaceRoot: normalizedWorkspaceRoot,
      hashVersion: SNAPSHOT_HASH_VERSION,
      changedFiles,
    }
    await appendManifest(store.manifestPath, entry)
    await checkAndPrune({ workspaceRoot: normalizedWorkspaceRoot })
    return entry
  } finally {
    await lock.release()
  }
}

export async function listSnapshots({ workspaceRoot, limit = 10 }) {
  const store = resolveSnapshotStore({ workspaceRoot })
  const entries = await readManifest(store.manifestPath)
  const normalizedLimit = Math.max(0, Number(limit) || 0)
  if (normalizedLimit === 0) return []
  return entries.slice(-normalizedLimit)
}

export async function restoreSnapshot({ workspaceRoot, snapshotId, timeoutMs }) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  const store = resolveSnapshotStore({ workspaceRoot: normalizedWorkspaceRoot })
  const lock = await acquireLock({
    workspaceRoot: normalizedWorkspaceRoot,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  try {
    const entries = await readManifest(store.manifestPath)
    const entry = entries.find(candidate => candidate.commitSha === snapshotId)
    if (!entry) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    // Reset the side-git index to the snapshot tree so the prune below (and the
    // added-files listing) reckon "not in the snapshot" against the snapshot
    // itself, never a stale post-turn `add -A` index that may have staged the very
    // files the turn created.
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'read-tree',
      snapshotId,
    ])

    // What the restore will change: tracked modifications + deletions (a
    // content-accurate diff against the snapshot commit) UNION untracked,
    // non-ignored files absent from the snapshot (which `clean` removes below).
    // The previous `git diff <commit>` alone under-reported added files.
    const trackedChanges = normalizeFileList(
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'diff',
        '--name-only',
        snapshotId,
        '--',
        '.',
      ]),
    )
    const addedFiles = normalizeFileList(
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'ls-files',
        '--others',
        '--exclude-standard',
      ]),
    )
    const affectedFiles = [...new Set([...trackedChanges, ...addedFiles])].sort()

    // Materialize every snapshot path (re-creating files deleted during the turn,
    // into any needed subdirectories), then remove worktree files absent from the
    // snapshot. `git checkout <commit> -- .` alone could not delete files the turn
    // CREATED, so the workspace was left as the snapshot UNION everything added
    // since — revert_turn/restore silently kept the model's new files. `clean -fd`
    // respects .gitignore, so ignored artifacts (node_modules/build) survive,
    // symmetric with capture's `add -A`. All commands run through the side-git
    // (--git-dir/--work-tree), never the user's .git.
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'checkout-index',
      '-f',
      '-a',
    ])
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, ['clean', '-fd'])

    return {
      snapshotId,
      affectedFileCount: affectedFiles.length,
      affectedFiles,
      entry,
    }
  } finally {
    await lock.release()
  }
}

function validateSnapshotPhase(phase) {
  if (!['pre', 'post', 'aborted'].includes(phase)) {
    throw new Error(`Invalid snapshot phase: ${phase}`)
  }
}

async function listCommitFiles(gitDir, workTree, commitSha, previousCommitSha) {
  if (previousCommitSha) {
    const raw = await runSideGit(gitDir, workTree, [
      'diff',
      '--name-only',
      previousCommitSha,
      commitSha,
    ])
    return normalizeFileList(raw)
  }
  const raw = await runSideGit(gitDir, workTree, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '--root',
    commitSha,
  ])
  return normalizeFileList(raw)
}

function normalizeFileList(raw) {
  return raw
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
}

function snapshotRefForCommit(commitSha) {
  return `refs/deepcode/snapshots/${commitSha}`
}
