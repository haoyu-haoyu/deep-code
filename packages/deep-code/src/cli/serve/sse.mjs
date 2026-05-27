import { once } from 'node:events'

export function writeSseHeaders(res) {
  res.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
}

export function encodeSseEvent({ data, event, id }) {
  const lines = []
  if (event) lines.push(`event: ${event}`)
  if (id !== undefined) lines.push(`id: ${id}`)

  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  for (const line of payload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }

  return `${lines.join('\n')}\n\n`
}

export function createSseWriter(res, { keepaliveMs = 15_000 } = {}) {
  let closed = false
  let sequence = 0
  const keepalive = setInterval(() => {
    void writeRaw(':\n\n')
  }, keepaliveMs)
  keepalive.unref?.()

  async function writeEvent(event, data) {
    sequence += 1
    return writeRaw(
      encodeSseEvent({
        data: {
          ...data,
          sequence,
          type: event,
        },
        event,
        id: sequence,
      }),
    )
  }

  async function writeRaw(payload) {
    if (closed || res.destroyed) return false
    try {
      if (!res.write(payload)) {
        await once(res, 'drain')
      }
      return true
    } catch {
      return false
    }
  }

  function close() {
    if (closed) return
    closed = true
    clearInterval(keepalive)
    if (!res.destroyed && !res.writableEnded) {
      res.end()
    }
  }

  return {
    close,
    writeEvent,
  }
}
