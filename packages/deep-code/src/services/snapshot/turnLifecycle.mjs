import { createSnapshot } from './index.mjs'

export async function captureTurnSnapshot({
  workspaceRoot = process.cwd(),
  turnId,
  phase,
  sessionId,
  createSnapshotFn = createSnapshot,
  onError,
}) {
  try {
    const entry = await createSnapshotFn({
      workspaceRoot,
      turnId,
      phase,
      ...(sessionId === undefined ? {} : { sessionId }),
    })
    return { ok: true, entry }
  } catch (error) {
    const snapshotError = { error, workspaceRoot, turnId, phase }
    onError?.(snapshotError)
    return { ok: false, error }
  }
}

export function getTurnEndSnapshotPhase({ aborted }) {
  return aborted ? 'aborted' : 'post'
}

// The key MUST stay in revert_turn's input grammar: the tool accepts only a
// numeric turn_id and its resolver matches "N" / "turn-N". Keying by message
// uuid (as an earlier revision did) made every live snapshot unmatchable —
// revert_turn could never find a snapshot in a real session. Cross-session
// turn-N collisions are disambiguated by the sessionId recorded on the entry,
// not by the key itself.
export function buildSnapshotTurnId({ generation }) {
  return `turn-${generation}`
}

export function formatSnapshotLifecycleError(errorOrEvent) {
  const phase =
    errorOrEvent && typeof errorOrEvent === 'object' ? errorOrEvent.phase : null
  const error =
    errorOrEvent && typeof errorOrEvent === 'object' && 'error' in errorOrEvent
      ? errorOrEvent.error
      : errorOrEvent
  const message = error instanceof Error ? error.message : String(error)
  return `Workspace snapshot${phase ? ` ${phase}` : ''} failed: ${message}`
}
