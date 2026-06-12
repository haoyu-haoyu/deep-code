import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../../utils/atomicWrite.mjs'
import { createSnapshot } from './index.mjs'
import { readManifest } from './manifest.mjs'
import { resolveSnapshotStore } from './paths.mjs'

// Per-session high-water marks of ISSUED turn ordinals, kept beside the
// manifest. A turn consumes its number at issuance, so a turn whose snapshot
// later fails still advances the numbering — otherwise the next turn would
// reuse turn-N and revert_turn({turn_id: N}) would restore the wrong turn.
const TURN_ORDINALS_FILE = 'turn-ordinals.json'
// Bounds the file across many sessions per workspace; oldest sessions drop
// first (insertion order), which only matters if one of them is resumed after
// 200 newer sessions — the manifest floor still covers that.
const MAX_TRACKED_SESSIONS = 200

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

// The session's next turn ordinal: one past the highest number this session
// has USED, where "used" is the max of (a) turn-N entries in the manifest and
// (b) the issued high-water mark in turn-ordinals.json. Unlike the process
// generation counter this survives /resume and fresh-process --resume (the
// resumed session's prior turns keep their numbers and new turns continue
// after them — matching the transcript ordinal the model means by "turn N").
// Parsing max-N rather than counting entries keeps numbering monotonic after
// diskCap pruned the oldest entries, and the issuance reservation keeps it
// monotonic past turns whose snapshots failed to persist.
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

  if (sessionId === undefined) {
    return `turn-${maxTurn + 1}`
  }

  const ordinalsPath = join(store.storePath, TURN_ORDINALS_FILE)
  const ordinals = await readTurnOrdinals(ordinalsPath)
  const issued = Number(ordinals[sessionId])
  if (Number.isInteger(issued) && issued > maxTurn) {
    maxTurn = issued
  }
  const next = maxTurn + 1
  // Best-effort reservation: a failure here degrades to manifest-floor-only
  // numbering (the pre-reservation behavior), never blocks the turn.
  try {
    delete ordinals[sessionId]
    const updated = { ...ordinals, [sessionId]: next }
    for (const key of Object.keys(updated)) {
      if (Object.keys(updated).length <= MAX_TRACKED_SESSIONS) break
      delete updated[key]
    }
    await mkdir(store.storePath, { recursive: true })
    await atomicWriteFile(ordinalsPath, JSON.stringify(updated))
  } catch {
    // degrade silently — the manifest floor still bounds the common case
  }
  return `turn-${next}`
}

async function readTurnOrdinals(ordinalsPath) {
  try {
    const parsed = JSON.parse(await readFile(ordinalsPath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
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
