import { listSnapshots, restoreSnapshot } from '../../services/snapshot/index.mjs'

export async function getRestoreSnapshotItems({
  workspaceRoot = process.cwd(),
  limit = 10,
} = {}) {
  const snapshots = await listSnapshots({ workspaceRoot, limit })
  return snapshots
    .slice()
    .reverse()
    .map(entry => ({
      snapshotId: entry.commitSha,
      turnId: entry.turnId,
      phase: entry.phase,
      timestamp: entry.timestamp,
      changedFileCount: entry.changedFiles?.length ?? 0,
      previewFiles: (entry.changedFiles ?? []).slice(0, 3),
      entry,
    }))
}

export function formatRestoreSnapshotLine(item) {
  const fileLabel =
    item.changedFileCount === 1
      ? '1 file'
      : `${item.changedFileCount} files`
  const preview =
    item.previewFiles.length > 0 ? `: ${item.previewFiles.join(', ')}` : ''
  return `${String(item.turnId)} ${item.phase} ${formatTimestamp(item.timestamp)} (${fileLabel}${preview})`
}

export async function performRestore({
  workspaceRoot = process.cwd(),
  snapshotId,
  confirmed = false,
  timeoutMs,
  restoreSnapshotFn = restoreSnapshot,
} = {}) {
  if (!snapshotId) {
    return {
      kind: 'error',
      message: 'No snapshot selected',
    }
  }

  if (!confirmed) {
    return {
      kind: 'confirmation_required',
      message:
        'Restore requires confirmation: it overwrites changed workspace files and removes files created after the snapshot (except ignored build artifacts).',
    }
  }

  try {
    const result = await restoreSnapshotFn({
      workspaceRoot,
      snapshotId,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    return {
      kind: 'restored',
      message: `Restored snapshot ${snapshotId.slice(0, 12)} (${result.affectedFileCount} affected ${result.affectedFileCount === 1 ? 'file' : 'files'}).`,
      result,
    }
  } catch (error) {
    if (isSnapshotStoreBusyError(error)) {
      return {
        kind: 'busy',
        message: 'Snapshot store busy, try again',
      }
    }
    return {
      kind: 'error',
      message: `Restore failed: ${error?.message ?? String(error)}`,
    }
  }
}

export function isSnapshotStoreBusyError(error) {
  return /Timed out acquiring snapshot lock/.test(error?.message ?? String(error))
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) return 'unknown time'
  return new Date(timestamp).toISOString()
}
