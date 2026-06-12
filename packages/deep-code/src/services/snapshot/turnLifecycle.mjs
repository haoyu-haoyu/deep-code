import { createSnapshot } from './index.mjs'
import { readManifest } from './manifest.mjs'
import { resolveSnapshotStore } from './paths.mjs'

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
//
// Fallback only (see nextSnapshotTurnId): the queryGuard generation is a
// PROCESS-local counter, so after /resume or --resume it restarts and would
// duplicate turn numbers the resumed session already used.
export function buildSnapshotTurnId({ generation }) {
  return `turn-${generation}`
}

// The session's next turn ordinal, derived from the manifest itself: max N
// over this session's existing turn-N entries, plus one. Unlike the process
// generation counter this survives /resume and fresh-process --resume (the
// resumed session's prior turns keep their numbers and new turns continue
// after them — matching the transcript ordinal the model means by "turn N"),
// and parsing max-N rather than counting entries keeps numbering monotonic
// even after diskCap pruned the oldest entries.
export async function nextSnapshotTurnId({
  workspaceRoot = process.cwd(),
  sessionId,
  readManifestFn = readManifest,
}) {
  const store = resolveSnapshotStore({ workspaceRoot })
  const entries = await readManifestFn(store.manifestPath)
  let maxTurn = 0
  for (const entry of entries) {
    if (sessionId !== undefined && entry.sessionId !== sessionId) continue
    const match = /^turn-(\d+)$/.exec(String(entry.turnId))
    if (!match) continue
    const value = Number(match[1])
    if (value > maxTurn) maxTurn = value
  }
  return `turn-${maxTurn + 1}`
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
