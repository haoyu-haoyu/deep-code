import { lstat, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveProjectSessionsDir, validateSessionId } from './sessionFork.mjs'
import { composeMetadata, scanSessionFile } from './sessionList.mjs'

// The transcript file + the session's sub-agent subdir for a given id, resolved
// against the SAME project dir `session list`/`fork` use. validateSessionId runs
// FIRST so a crafted id (e.g. "../../etc/passwd") can never escape the dir.
function resolveSessionPaths({ sessionId, sessionDir, cwd } = {}) {
  validateSessionId(sessionId, 'sessionId')
  const projectDir = resolveProjectSessionsDir({ sessionDir, cwd })
  return {
    file: join(projectDir, `${sessionId}.jsonl`),
    subdir: join(projectDir, sessionId), // <projectDir>/<id>/subagents/… lives here
  }
}

// Rich metadata for a single session — the same title/turn semantics as
// `session list` (shared scanner, so `show` and `list` can never disagree) plus
// message count, cwd, gitBranch, and first/last timestamps. Returns
// { exists: false } when the transcript is absent (the caller reports not-found).
export async function getSessionDetail({ sessionId, sessionDir, cwd } = {}) {
  const { file } = resolveSessionPaths({ sessionId, sessionDir, cwd })

  let stats
  try {
    // lstat (not stat): do NOT follow symlinks. `session list` only lists regular
    // files (dirent.isFile()), so a planted `<uuid>.jsonl` symlink must be
    // invisible here too — both for list/show consistency and so `show` can't be
    // tricked into reading a file outside the project store.
    stats = await lstat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { sessionId, path: file, exists: false }
    throw error
  }
  if (!stats.isFile()) return { sessionId, path: file, exists: false }

  let acc
  try {
    acc = await scanSessionFile(file)
  } catch (error) {
    // Raced deletion between lstat and the streamed read → treat as not-found,
    // matching listSessions' analogous race handling.
    if (error?.code === 'ENOENT') return { sessionId, path: file, exists: false }
    throw error
  }
  return {
    sessionId,
    path: file,
    exists: true,
    modifiedMs: stats.mtimeMs,
    turnCount: acc.turnCount,
    messageCount: acc.messageCount,
    sidechain: acc.isSidechain === true,
    corrupt: acc.corrupt,
    cwd: acc.cwd,
    gitBranch: acc.gitBranch,
    firstTimestamp: acc.firstTimestamp,
    ...composeMetadata(acc),
  }
}

// Delete a session: its transcript file AND its sub-agent subdir
// (<projectDir>/<id>/, where sub-agent transcripts live). Idempotent — removing a
// non-existent session reports existed:false rather than throwing. Returns the
// paths actually removed.
export async function removeSession({ sessionId, sessionDir, cwd } = {}) {
  const { file, subdir } = resolveSessionPaths({ sessionId, sessionDir, cwd })

  const removed = []
  try {
    await unlink(file)
    removed.push(file)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  // Remove the sub-agent subdir if present. NO force: ENOENT (the common case —
  // most sessions have no sub-agents) is expected and ignored, but a REAL error
  // (EACCES/IO) is surfaced rather than silently swallowed. Track it in `removed`
  // only when actually deleted, so the reported count is accurate.
  try {
    await rm(subdir, { recursive: true })
    removed.push(subdir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  // existed = anything was actually removed — so deleting an ORPHANED sub-agent
  // subdir (transcript already gone) still reports success rather than not-found.
  return { sessionId, path: file, removed, existed: removed.length > 0 }
}
