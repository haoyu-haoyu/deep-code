import { join } from 'node:path'
import { readManifest } from './manifest.mjs'

// Reclaim ABANDONED per-workspace snapshot stores. A store
// (~/.deepcode/snapshots/<hash> — a side .git repo + manifest.json) is created
// the first time a workspace is snapshotted, and is only ever pruned by ITS OWN
// checkAndPrune when that same workspace is reopened. A workspace that is deleted
// or simply never revisited leaves its store on disk forever, so total snapshot
// disk grows in the number of projects ever opened — and no GC pass reclaimed
// it. This sweep removes a whole store whose newest snapshot activity is older
// than the cutoff.
//
// Pure + node-testable; deps injected. `fs` matches cleanup.ts's FsOperations
// shape (readdir → Dirent[], stat → Stats, rm). The cutoff is a timestamp in ms
// (Date.now()-based), compared against the manifest's newest entry.timestamp.
export async function reclaimAbandonedSnapshotStoresCore({
  baseDir,
  cutoffMs,
  fs,
  loadManifest = readManifest,
}) {
  const result = { messages: 0, errors: 0 }

  let dirents
  try {
    dirents = await fs.readdir(baseDir, { withFileTypes: true })
  } catch {
    // No snapshots base dir yet — nothing to reclaim.
    return result
  }

  for (const dirent of dirents) {
    // Stores are directories named by workspace hash; ignore stray files.
    if (!dirent.isDirectory()) continue
    const storePath = join(baseDir, dirent.name)
    try {
      const lastActivity = await lastActivityMs(storePath, fs, loadManifest)
      if (lastActivity < cutoffMs) {
        await fs.rm(storePath, { recursive: true, force: true })
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  return result
}

// Newest snapshot time for a store: the max manifest entry.timestamp (the true
// last-snapshot time, which survives a git gc/repack that might touch the dir
// mtime). Falls back to the store dir mtime when the manifest is empty / missing
// / corrupt (readManifest returns [] for all of those) so a brand-new or
// manifest-less store is judged by its age, not reclaimed on a 0 timestamp.
async function lastActivityMs(storePath, fs, loadManifest) {
  const entries = await loadManifest(join(storePath, 'manifest.json'))
  let newest = 0
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const t = typeof entry?.timestamp === 'number' ? entry.timestamp : 0
      if (t > newest) newest = t
    }
  }
  if (newest > 0) return newest

  const stats = await fs.stat(storePath)
  return stats.mtime.getTime()
}
