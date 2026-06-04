import { listSessions } from '../../utils/sessionList.mjs'

// CLI handler for `deepcode session list`. Thin: resolve the sessions via the
// pure core, then render either JSON (scriptable) or a fixed-width table. The
// core is injectable for tests; nothing here touches the write path.
export async function listSessionsHandler({
  all = false,
  json = false,
  limit,
  listSessionsFn = listSessions,
  sessionDir,
  stdout = process.stdout,
} = {}) {
  const sessions = await listSessionsFn({ sessionDir, limit, includeSidechains: all })

  if (json) {
    stdout.write(`${JSON.stringify(sessions, null, 2)}\n`)
    return sessions
  }

  if (sessions.length === 0) {
    stdout.write('No saved sessions for this project.\n')
    return sessions
  }

  for (const session of sessions) {
    const shortId = session.sessionId.slice(0, 8)
    const turns = `${session.turnCount}`.padStart(4)
    const when = formatTimestamp(session.modifiedMs)
    const title = truncate(session.title || '(untitled)', 60)
    const flags = `${session.sidechain ? ' (sidechain)' : ''}${session.corrupt ? ' [corrupt]' : ''}`
    stdout.write(`${shortId}  ${turns} turns  ${when}  ${title}${flags}\n`)
  }
  return sessions
}

// Absolute, deterministic "YYYY-MM-DD HH:MM" from the file mtime (UTC). Absolute
// rather than relative so output is stable + testable without injecting a clock.
function formatTimestamp(modifiedMs) {
  if (typeof modifiedMs !== 'number' || !Number.isFinite(modifiedMs)) return '----------------'
  return new Date(modifiedMs).toISOString().replace('T', ' ').slice(0, 16)
}

function truncate(text, max) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}
