import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  lstat,
  mkdir,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { readManifest } from './manifest.mjs'
import { normalizeWorkspaceRoot, resolveSnapshotStore } from './paths.mjs'
import { runSideGit } from './storeInit.mjs'

export const DEFAULT_DISK_CAP_BYTES = 500 * 1024 * 1024

export async function checkAndPrune({
  workspaceRoot,
  capBytes = DEFAULT_DISK_CAP_BYTES,
}) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  const store = resolveSnapshotStore({ workspaceRoot: normalizedWorkspaceRoot })
  let finalBytes = await getSnapshotStoreSize(store.storePath)
  if (finalBytes <= capBytes) return { prunedCount: 0, finalBytes }

  let entries = await readManifest(store.manifestPath)

  // Reclaim snapshot refs the manifest no longer lists before evicting live
  // snapshots. Orphans arise two ways: the manifest was healed from corruption
  // (the pre-corruption refs survive in the store but drop out of the rebuilt
  // manifest), or a crash landed between createSnapshot's update-ref and its
  // manifest append. Their refs keep them reachable, so git prune can never
  // collect them — without this the cap would evict good snapshots while the
  // orphans leak forever. Guard on a non-empty manifest: an empty read is
  // ambiguous (a corrupt manifest degrades to [] too), and we must never treat
  // every ref as an orphan and wipe the whole store.
  if (entries.length > 0) {
    const reclaimed = await reclaimOrphanedRefs(
      store.gitDir,
      normalizedWorkspaceRoot,
      entries,
    )
    if (reclaimed) {
      finalBytes = await getSnapshotStoreSize(store.storePath)
      if (finalBytes <= capBytes) return { prunedCount: 0, finalBytes }
    }
  }

  const pruneOrder = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.timestamp - right.entry.timestamp)
  let prunedCount = 0
  let gcAttempted = false
  // The git OBJECT store (loose objects + packfiles) is what eviction must
  // shrink. We track it separately from the whole-store size because each
  // eviction also rewrites a smaller manifest.json — a few-hundred-byte drop
  // that would otherwise masquerade as "progress" even when no git object was
  // reclaimed, defeating the no-progress guard below.
  const objectsDir = join(store.gitDir, 'objects')

  for (const candidate of pruneOrder) {
    if (finalBytes <= capBytes) break
    entries = entries.filter(entry => entry !== candidate.entry)
    await writeManifestAtomically(store.manifestPath, entries)
    prunedCount += 1

    // commit-tree is deterministic, so two manifest entries that captured the
    // same (tree, message, author/committer, whole-second timestamp) share ONE
    // commitSha — hence one ref and one commit object. Only delete the ref and
    // prune the object when NO retained entry still references this sha;
    // otherwise the ref/object stays live for the surviving sibling, which would
    // otherwise become unrestoreable ("failed to unpack tree object"). Mirrors
    // reclaimOrphanedRefs's live-set guard, computed against the post-removal
    // entries. A skipped (still-shared) eviction reclaims no object BY DESIGN, so
    // it must bypass the no-progress guard below: the shared object is reclaimed
    // later when its last referencing entry is evicted.
    if (commitShaStillReferenced(entries, candidate.entry.commitSha)) continue

    const objectsBefore = await getSnapshotStoreSize(objectsDir)
    await deleteSnapshotRef(store.gitDir, normalizedWorkspaceRoot, candidate.entry)
    await pruneUnreachableObjects(store.gitDir, normalizedWorkspaceRoot)
    const objectsAfter = await getSnapshotStoreSize(objectsDir)
    finalBytes = await getSnapshotStoreSize(store.storePath)

    // No-progress guard. `git prune` only collects LOOSE objects; if the store
    // was packed (an external `git gc`/repack ran against it), this eviction
    // reclaimed no git object. Without this, the loop would delete EVERY
    // remaining ref — wiping all restore/revert_turn history — while the
    // packfile stays put and the store never drops below the cap. On the first
    // stall, reclaim packed objects once via gc; if THAT still frees no object,
    // STOP rather than keep destroying history against an unreclaimable store.
    // The common (loose) path shrinks the object store every iteration and never
    // gc's, so there is no per-eviction gc cost.
    if (objectsAfter >= objectsBefore && entries.length > 0) {
      if (gcAttempted) break
      gcAttempted = true
      await reclaimPackedObjects(store.gitDir, normalizedWorkspaceRoot)
      finalBytes = await getSnapshotStoreSize(store.storePath)
      if (finalBytes <= capBytes) break
    }
  }

  return { prunedCount, finalBytes }
}

export async function getSnapshotStoreSize(path) {
  if (!existsSync(path)) return 0
  const stat = await lstat(path)
  if (!stat.isDirectory()) return stat.size
  const entries = await readdir(path, { withFileTypes: true })
  let total = stat.size
  for (const entry of entries) {
    const childPath = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await getSnapshotStoreSize(childPath)
    } else {
      total += (await lstat(childPath)).size
    }
  }
  return total
}

async function reclaimOrphanedRefs(gitDir, workTree, entries) {
  const live = new Set(
    entries.map(entry => entry?.commitSha).filter(Boolean),
  )
  let raw
  try {
    raw = await runSideGit(gitDir, workTree, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/deepcode/snapshots/',
    ])
  } catch {
    // Older stores without per-snapshot refs (or a transient git failure):
    // nothing to reconcile, fall through to the normal manifest-based prune.
    return false
  }
  const orphanRefs = raw
    .split('\n')
    .map(ref => ref.trim())
    .filter(Boolean)
    .filter(ref => {
      const commitSha = ref.slice('refs/deepcode/snapshots/'.length)
      return commitSha.length > 0 && !live.has(commitSha)
    })
  if (orphanRefs.length === 0) return false

  for (const ref of orphanRefs) {
    try {
      await runSideGit(gitDir, workTree, ['update-ref', '-d', ref])
    } catch {
      // Best-effort: a ref deleted concurrently is already reclaimed.
    }
  }
  await pruneUnreachableObjects(gitDir, workTree)
  return true
}

// True when a RETAINED manifest entry still carries `commitSha` — so its shared
// snapshot ref and commit object must not be deleted/pruned. `entries` is the
// post-removal list (the candidate already filtered out), so the candidate's own
// entry never counts as a referencer.
export function commitShaStillReferenced(entries, commitSha) {
  if (!commitSha) return false
  return entries.some(entry => entry?.commitSha === commitSha)
}

async function deleteSnapshotRef(gitDir, workTree, entry) {
  if (!entry?.commitSha) return
  try {
    await runSideGit(gitDir, workTree, [
      'update-ref',
      '-d',
      snapshotRefForCommit(entry.commitSha),
    ])
  } catch {
    // Older snapshot stores may not have per-snapshot refs; pruning still
    // removes the manifest entry and runs git prune for unreachable objects.
  }
}

async function pruneUnreachableObjects(gitDir, workTree) {
  await runSideGit(gitDir, workTree, ['reflog', 'expire', '--expire=now', '--all'])
  await runSideGit(gitDir, workTree, ['prune', '--expire=now'])
}

// `git prune` drops only LOOSE unreachable objects; `gc --prune=now` also
// repacks and discards unreachable objects living inside a packfile (which a
// `git gc`/repack run against the side store leaves behind). Only invoked when
// the loose prune above stalls, so the common path never pays for a gc.
async function reclaimPackedObjects(gitDir, workTree) {
  await runSideGit(gitDir, workTree, ['gc', '--prune=now'])
}

async function writeManifestAtomically(manifestPath, entries) {
  await mkdir(dirname(manifestPath), { recursive: true })
  const tmpPath = `${manifestPath}.${randomUUID()}.tmp`
  try {
    await writeFile(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(tmpPath, manifestPath)
  } catch (error) {
    try {
      await unlink(tmpPath)
    } catch {}
    throw error
  }
}

function snapshotRefForCommit(commitSha) {
  return `refs/deepcode/snapshots/${commitSha}`
}
