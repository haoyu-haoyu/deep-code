import { listSnapshots, restoreSnapshot } from '../../services/snapshot/index.mjs'

export function validateRevertTurnInput(input) {
  const keys = Object.keys(input ?? {})
  if (keys.length !== 1 || keys[0] !== 'turn_id') {
    throw new Error('revert_turn only accepts {turn_id: number}')
  }
  if (!Number.isInteger(input.turn_id) || input.turn_id <= 0) {
    throw new Error('revert_turn turn_id must be a positive integer')
  }
  return { turnId: input.turn_id }
}

export async function resolveRevertTurnSnapshot({
  workspaceRoot = process.cwd(),
  turnId,
  listSnapshotsFn = listSnapshots,
} = {}) {
  const snapshots = await listSnapshotsFn({ workspaceRoot, limit: 100 })
  const matches = snapshots.filter(entry => snapshotMatchesTurn(entry, turnId))
  const preMatches = matches.filter(entry => entry.phase === 'pre')
  const selected = (preMatches.length > 0 ? preMatches : matches).at(-1)
  if (!selected) {
    throw new Error(`No snapshot found for turn ${turnId}`)
  }
  return selected
}

export async function performRevertTurn({
  workspaceRoot = process.cwd(),
  input,
  listSnapshotsFn = listSnapshots,
  restoreSnapshotFn = restoreSnapshot,
} = {}) {
  const { turnId } = validateRevertTurnInput(input)
  const snapshot = await resolveRevertTurnSnapshot({
    workspaceRoot,
    turnId,
    listSnapshotsFn,
  })
  const restored = await restoreSnapshotFn({
    workspaceRoot,
    snapshotId: snapshot.commitSha,
  })
  const result = {
    turnId,
    phase: snapshot.phase,
    snapshotId: snapshot.commitSha,
    affectedFileCount: restored.affectedFileCount ?? 0,
    affectedFiles: restored.affectedFiles ?? [],
  }
  return {
    ...result,
    message: formatRevertTurnResult(result),
  }
}

export function buildRevertTurnPermissionResult(input) {
  const turnId = input?.turn_id ?? '?'
  return {
    behavior: 'ask',
    message: `revert_turn will restore the pre-turn snapshot for turn ${turnId}: it overwrites changed workspace files AND removes files created after that snapshot (except ignored build artifacts). Confirm before continuing.`,
    decisionReason: {
      type: 'safetyCheck',
      reason:
        'revert_turn restores workspace files from side-git snapshots, overwriting local changes and removing files created after the snapshot (ignored build artifacts are kept)',
      classifierApprovable: false,
    },
  }
}

export function formatRevertTurnResult(result) {
  const count = result.affectedFileCount ?? 0
  return `Reverted turn ${result.turnId} using ${result.phase} snapshot ${String(result.snapshotId).slice(0, 12)} (${count} affected ${count === 1 ? 'file' : 'files'}).`
}

function snapshotMatchesTurn(entry, turnId) {
  const raw = String(entry.turnId)
  return raw === String(turnId) || raw === `turn-${turnId}`
}
