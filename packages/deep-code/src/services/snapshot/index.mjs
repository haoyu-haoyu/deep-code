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

    const affectedFiles = await listWorkingTreeDiffFiles(
      store.gitDir,
      normalizedWorkspaceRoot,
      snapshotId,
    )
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'checkout',
      snapshotId,
      '--',
      '.',
    ])

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

async function listWorkingTreeDiffFiles(gitDir, workTree, commitSha) {
  const raw = await runSideGit(gitDir, workTree, [
    'diff',
    '--name-only',
    commitSha,
    '--',
    '.',
  ])
  return normalizeFileList(raw)
}

function snapshotRefForCommit(commitSha) {
  return `refs/deepcode/snapshots/${commitSha}`
}
