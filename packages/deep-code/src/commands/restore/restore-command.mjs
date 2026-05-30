import { listSnapshots, restoreSnapshot } from '../../services/snapshot/index.mjs'
import { getMessage } from '../../i18n/index.js'

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
      ? getMessage('restore.fileLabel.singular')
      : getMessage('restore.fileLabel.plural', {
          count: item.changedFileCount,
        })
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
      message: getMessage('restore.error.noSnapshotSelected'),
    }
  }

  if (!confirmed) {
    return {
      kind: 'confirmation_required',
      message: getMessage('restore.confirmationRequired'),
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
      message: getMessage('restore.result.restored', {
        snapshotId: snapshotId.slice(0, 12),
        count: result.affectedFileCount,
        fileWord:
          result.affectedFileCount === 1
            ? getMessage('diagnostics.file.singular')
            : getMessage('diagnostics.file.plural'),
      }),
      result,
    }
  } catch (error) {
    if (isSnapshotStoreBusyError(error)) {
      return {
        kind: 'busy',
        message: getMessage('restore.error.storeBusy'),
      }
    }
    return {
      kind: 'error',
      message: getMessage('restore.error.failed', {
        error: error?.message ?? String(error),
      }),
    }
  }
}

export function isSnapshotStoreBusyError(error) {
  return /Timed out acquiring snapshot lock/.test(error?.message ?? String(error))
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) return getMessage('restore.unknownTime')
  return new Date(timestamp).toISOString()
}
