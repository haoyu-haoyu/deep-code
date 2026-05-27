import { createSseWriter, writeSseHeaders } from './sse.mjs'
import { runTurn } from './turnRunner.mjs'

export async function handleTurnStream({
  body,
  req,
  res,
  sessionId,
  sessions,
  turnRunner = runTurn,
}) {
  const abortController = new AbortController()
  const started = sessions.startTurn(sessionId, { abortController })

  if (started.status === 'not_found') {
    writeJson(res, 404, { error: 'not_found' })
    return
  }
  if (started.status === 'conflict') {
    writeJson(res, 409, { error: 'turn_already_running' })
    return
  }

  const { session, turn } = started
  writeSseHeaders(res)
  const writer = createSseWriter(res)
  let settled = false
  const abortOnClose = () => {
    if (!settled && !abortController.signal.aborted) {
      abortController.abort()
    }
  }
  res.on('close', abortOnClose)

  try {
    for await (const event of turnRunner({
      input: body,
      session,
      signal: abortController.signal,
      turn,
    })) {
      await writer.writeEvent(event.type, {
        event,
        session_id: sessionId,
        turn_id: turn.id,
      })
    }

    settled = true
    if (abortController.signal.aborted) {
      sessions.completeTurn(sessionId, turn.id, { status: 'aborted' })
      await writer.writeEvent('error', {
        error: 'aborted',
        session_id: sessionId,
        status: 'aborted',
        turn_id: turn.id,
      })
    } else {
      sessions.completeTurn(sessionId, turn.id, { status: 'completed' })
      await writer.writeEvent('final', {
        session_id: sessionId,
        status: 'completed',
        turn_id: turn.id,
      })
    }
  } catch (error) {
    settled = true
    const aborted = abortController.signal.aborted
    const status = aborted ? 'aborted' : 'error'
    sessions.completeTurn(sessionId, turn.id, {
      error: error instanceof Error ? error.message : String(error),
      status,
    })
    await writer.writeEvent('error', {
      error: status === 'aborted' ? 'aborted' : 'turn_failed',
      session_id: sessionId,
      status,
      turn_id: turn.id,
    })
  } finally {
    settled = true
    res.off('close', abortOnClose)
    writer.close()
  }
}

export function writeJson(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(payload)
}
