import { rm } from 'node:fs/promises'
import { join } from 'node:path'
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

// Upper bound on restore prune passes (see restoreSnapshot). Each pass strips one
// nesting layer of turn-created untracked .gitignore files, so the realistic worst
// case is bounded by directory depth; this cap only guards against a pathologically
// deep chain of self-hiding ignore files.
const MAX_PRUNE_PASSES = 64

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

    // Reset the side-git index to the snapshot tree so everything below reckons
    // "in the snapshot" against the snapshot itself, never a stale post-turn
    // `add -A` index that may have staged the very files the turn created. `-z`
    // gives raw NUL-separated paths so non-ASCII / spaced filenames aren't
    // C-quoted in the reported set.
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'read-tree',
      snapshotId,
    ])

    // Tracked modifications + deletions, captured BEFORE the worktree is restored
    // (afterwards the diff would be empty). Content-accurate, .gitignore-independent.
    const trackedChanges = normalizeNulFileList(
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'diff',
        '--name-only',
        '-z',
        snapshotId,
        '--',
        '.',
      ]),
    )

    // Worktree paths that conflict by TYPE with a snapshot path (a turn replaced a
    // tracked directory `dir/` with a file `dir`, or vice versa). checkout-index
    // would error on these, leaving a half-restored workspace, so remove them
    // first. `ls-files --killed` reckons file/dir conflicts against the index (just
    // reset to the snapshot) and is independent of .gitignore.
    const killedPaths = normalizeNulFileList(
      await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'ls-files',
        '--killed',
        '-z',
      ]),
    )
    for (const killed of killedPaths) {
      await rm(join(normalizedWorkspaceRoot, killed), {
        recursive: true,
        force: true,
      })
    }

    // Materialize every snapshot path — re-creating files deleted during the turn
    // into any needed subdirectories, AND restoring the snapshot's own tracked
    // .gitignore files — BEFORE the prune, so `clean` reckons "ignored" against the
    // SNAPSHOT's ignore rules. (If a turn broadened a tracked .gitignore and created
    // files under the new rule, pruning against the live .gitignore would wrongly
    // preserve them.)
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
      'checkout-index',
      '-f',
      '-a',
    ])

    // Prune untracked files the turn created (absent from the snapshot), keeping
    // artifacts ignored by the now-restored snapshot .gitignore (node_modules,
    // build outputs) — symmetric with capture's `add -A`. A single `clean -fd` is
    // not enough: a turn may have created an UNTRACKED nested .gitignore (e.g.
    // `build/.gitignore` listing `junk.txt`) that hides its siblings from BOTH the
    // added-files listing AND `clean`, leaving them behind. Each pass removes the
    // outermost untracked, non-ignored frontier — including any such turn-created
    // .gitignore — which un-shadows the next layer, so loop to a fixpoint. All
    // commands run through the side-git (--git-dir/--work-tree), never the user's
    // .git.
    const addedFiles = []
    for (let pass = 0; pass < MAX_PRUNE_PASSES; pass += 1) {
      const frontier = normalizeNulFileList(
        await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      )
      if (frontier.length === 0) break
      for (const file of frontier) addedFiles.push(file)
      const removed = await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
        'clean',
        '-fd',
      ])
      // No-progress guard: `clean` prints a line per removed path, so empty output
      // means it removed nothing this pass (e.g. a nested git repo it refuses to
      // touch). Stop rather than spin to the pass cap.
      if (removed.trim() === '') break
    }

    const affectedFiles = [
      ...new Set([...trackedChanges, ...killedPaths, ...addedFiles]),
    ].sort()

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

// Parse a NUL-separated (`-z`) git path list. Unlike normalizeFileList this does
// NOT trim or interpret the bytes, so non-ASCII / spaced filenames survive intact
// (git only C-quotes paths in the newline-separated output).
function normalizeNulFileList(raw) {
  return raw.split('\0').filter(Boolean)
}

function snapshotRefForCommit(commitSha) {
  return `refs/deepcode/snapshots/${commitSha}`
}
