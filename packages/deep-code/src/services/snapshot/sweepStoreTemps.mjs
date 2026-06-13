import { join } from 'node:path'
import { readdir, stat, unlink } from 'node:fs/promises'

// manifest.mjs, diskCap.mjs and atomicWrite.mjs (turn-ordinals.json) all write
// `<name>.<uuid>.tmp` then rename it onto the target. A SIGKILL / OOM /
// power-loss landing in the window BETWEEN the writeFile/open and the rename
// leaves the tmp orphaned forever — the in-process catch+unlink never fires —
// and a fresh UUID per write means orphans never overwrite each other, so they
// accumulate across hard crashes AND count against the per-store disk cap
// (getSnapshotStoreSize sums every file). No pass reclaimed them.
const STORE_TEMP_RE = /^(manifest\.json|turn-ordinals\.json)\..*\.tmp$/

// Delete orphaned store temp files older than ttlMs. The TTL (minutes) is the
// safety guarantee: a real atomic write's tmp lives for milliseconds, so a tmp
// older than the TTL is necessarily orphaned — even a turn-ordinals write that
// does NOT hold the snapshot lock can't be mid-flight that long. Run under the
// snapshot lock in createSnapshot. Pure + node-testable; fs + clock injectable.
// A per-file failure is counted and skipped; a missing store dir is a no-op.
export async function sweepStoreTemps(storePath, ttlMs, deps = {}) {
  const _readdir = deps.readdir ?? readdir
  const _stat = deps.stat ?? stat
  const _unlink = deps.unlink ?? unlink
  const now = deps.now ?? Date.now()

  const result = { removed: 0, errors: 0 }

  let dirents
  try {
    dirents = await _readdir(storePath, { withFileTypes: true })
  } catch {
    return result
  }

  for (const dirent of dirents) {
    if (!dirent.isFile() || !STORE_TEMP_RE.test(dirent.name)) continue
    const filePath = join(storePath, dirent.name)
    try {
      const stats = await _stat(filePath)
      if (now - stats.mtimeMs > ttlMs) {
        await _unlink(filePath)
        result.removed++
      }
    } catch {
      result.errors++
    }
  }

  return result
}
