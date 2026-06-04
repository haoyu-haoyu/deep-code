import { getSessionDetail } from '../../utils/sessionDetail.mjs'

// CLI handler for `deepcode session show <id>`. Thin: resolve detail via the pure
// core, then render JSON (scriptable) or a human block. Returns the detail so the
// command can set a non-zero exit when the session is absent. Core injectable.
export async function showSessionHandler({
  sessionId,
  json = false,
  getDetailFn = getSessionDetail,
  sessionDir,
  stdout = process.stdout,
} = {}) {
  const detail = await getDetailFn({ sessionId, sessionDir })

  if (json) {
    stdout.write(`${JSON.stringify(detail, null, 2)}\n`)
    return detail
  }

  if (!detail.exists) {
    stdout.write(`Session ${sessionId} not found for this project.\n`)
    return detail
  }

  const lines = [
    `Session ${detail.sessionId}`,
    `  title:    ${detail.title || '(untitled)'}`,
    `  turns:    ${detail.turnCount}   messages: ${detail.messageCount}`,
    `  created:  ${detail.firstTimestamp || '(unknown)'}`,
    `  modified: ${detail.lastTimestamp || isoFromMs(detail.modifiedMs)}`,
  ]
  if (detail.cwd) lines.push(`  cwd:      ${detail.cwd}`)
  if (detail.gitBranch) lines.push(`  branch:   ${detail.gitBranch}`)
  if (detail.summary) lines.push(`  summary:  ${detail.summary}`)
  const flags = [detail.sidechain && 'sidechain', detail.corrupt && 'corrupt'].filter(Boolean)
  if (flags.length) lines.push(`  flags:    ${flags.join(', ')}`)
  stdout.write(`${lines.join('\n')}\n`)
  return detail
}

function isoFromMs(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : '(unknown)'
}
