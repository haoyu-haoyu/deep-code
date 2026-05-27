import { createSnapshot } from './index.mjs'

export async function captureTurnSnapshot({
  workspaceRoot = process.cwd(),
  turnId,
  phase,
  createSnapshotFn = createSnapshot,
  onError,
}) {
  try {
    const entry = await createSnapshotFn({ workspaceRoot, turnId, phase })
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

export function buildSnapshotTurnId({ generation, messages = [] }) {
  const message = messages.find(
    candidate =>
      candidate &&
      typeof candidate === 'object' &&
      typeof candidate.uuid === 'string' &&
      candidate.uuid.length > 0,
  )
  return message?.uuid ?? `turn-${generation}`
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
