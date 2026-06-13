import { join } from 'node:path'

// Reclaim orphaned shell-snapshot files. The Bash tool writes one
// `snapshot-<shell>-<timestamp>-<rand>.sh` per session under
// ~/.claude/shell-snapshots and only removes it on a GRACEFUL shutdown — a
// SIGKILL / OOM / power-loss / force-closed terminal leaves it orphaned
// forever, so the directory grows without bound across crashed sessions. None
// of the other GC passes touch it. This pure, node-testable sweep deletes the
// snapshot files older than `cutoffDate` by mtime (mirroring the mtime policy
// the rest of cleanup.ts uses); the .ts wrapper supplies the real path, cutoff,
// and FsOperations. `fsImpl` matches cleanup.ts's FsOperations shape
// (readdir → Dirent[], stat → Stats, unlink) so it can pass
// getFsImplementation(); tests inject a node:fs/promises adapter.
//
// Only `snapshot-*.sh` files are swept (the exact name the Bash tool writes), so
// an unrelated file someone drops in the directory is never deleted. A per-file
// failure is counted and skipped, never thrown — one bad entry must not abort
// the rest of the background cleanup.
export async function cleanupOldShellSnapshotsCore(dirPath, cutoffDate, fsImpl) {
  const result = { messages: 0, errors: 0 }

  let dirents
  try {
    dirents = await fsImpl.readdir(dirPath)
  } catch {
    // No snapshots directory yet (ENOENT) — nothing to reclaim.
    return result
  }

  for (const dirent of dirents) {
    if (
      !dirent.isFile() ||
      !dirent.name.startsWith('snapshot-') ||
      !dirent.name.endsWith('.sh')
    ) {
      continue
    }
    const filePath = join(dirPath, dirent.name)
    try {
      const stats = await fsImpl.stat(filePath)
      if (stats.mtime < cutoffDate) {
        await fsImpl.unlink(filePath)
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  return result
}
