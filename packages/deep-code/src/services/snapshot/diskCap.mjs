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
  const pruneOrder = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.timestamp - right.entry.timestamp)
  let prunedCount = 0

  for (const candidate of pruneOrder) {
    if (finalBytes <= capBytes) break
    await deleteSnapshotRef(store.gitDir, normalizedWorkspaceRoot, candidate.entry)
    entries = entries.filter(entry => entry !== candidate.entry)
    await writeManifestAtomically(store.manifestPath, entries)
    await pruneUnreachableObjects(store.gitDir, normalizedWorkspaceRoot)
    finalBytes = await getSnapshotStoreSize(store.storePath)
    prunedCount += 1
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
