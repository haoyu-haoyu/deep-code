import { createServer } from 'node:http'

import {
  validateBearerToken,
  writeJson,
  writeUnauthorized,
} from './auth.mjs'
import { createSessionRegistry } from './sessions.mjs'

export const DEFAULT_HTTP_HOST = '127.0.0.1'
export const DEFAULT_HTTP_PORT = 8765

export async function startHttpServer({
  env = process.env,
  host = DEFAULT_HTTP_HOST,
  installSignalHandlers = true,
  port = DEFAULT_HTTP_PORT,
  processLike = process,
  sessions = createSessionRegistry(),
} = {}) {
  const normalizedHost = normalizeHost(host)
  const normalizedPort = normalizePort(port)
  const server = createServer((req, res) => {
    void handleRequest(req, res, { env, sessions }).catch(() => {
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'internal_server_error' })
      } else {
        res.destroy()
      }
    })
  })

  let resolveClosed
  const closed = new Promise(resolve => {
    resolveClosed = resolve
  })
  server.once('close', () => resolveClosed())

  await listen(server, normalizedPort, normalizedHost)

  let closeStarted = false
  const cleanupSignalHandlers = () => {
    if (!installSignalHandlers) return
    processLike.removeListener?.('SIGINT', onSignal)
    processLike.removeListener?.('SIGTERM', onSignal)
  }
  const close = async () => {
    if (closeStarted) return closed
    closeStarted = true
    cleanupSignalHandlers()

    if (!server.listening) {
      resolveClosed()
      return closed
    }

    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    return closed
  }
  const onSignal = () => {
    void close()
  }

  if (installSignalHandlers) {
    processLike.once('SIGINT', onSignal)
    processLike.once('SIGTERM', onSignal)
  }

  const address = server.address()
  const actualHost =
    typeof address === 'object' && address ? address.address : normalizedHost
  const actualPort =
    typeof address === 'object' && address ? address.port : normalizedPort

  return {
    close,
    closed,
    host: actualHost,
    port: actualPort,
    server,
    url: `http://${actualHost}:${actualPort}`,
  }
}

async function handleRequest(req, res, { env, sessions }) {
  if (!validateBearerToken(req, { env })) {
    writeUnauthorized(res)
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathParts = url.pathname.split('/').filter(Boolean)

  if (url.pathname === '/sessions') {
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      if (error instanceof BadRequestError) {
        writeJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    const session = sessions.createSession({
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
    })
    writeJson(res, 200, { session_id: session.id })
    return
  }

  if (pathParts.length === 2 && pathParts[0] === 'sessions') {
    const sessionId = pathParts[1]

    if (req.method === 'GET') {
      const session = sessions.getSession(sessionId)
      if (!session) {
        writeJson(res, 404, { error: 'not_found' })
        return
      }
      writeJson(res, 200, session)
      return
    }

    if (req.method === 'DELETE') {
      if (!sessions.deleteSession(sessionId)) {
        writeJson(res, 404, { error: 'not_found' })
        return
      }
      res.writeHead(204)
      res.end()
      return
    }

    writeJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  writeJson(res, 404, { error: 'not_found' })
}

async function readJsonBody(req, { limitBytes = 1024 * 1024 } = {}) {
  let body = ''

  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > limitBytes) {
      throw new BadRequestError('request_body_too_large')
    }
  }

  if (!body.trim()) return {}

  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestError('request_body_must_be_object')
    }
    return parsed
  } catch (error) {
    if (error instanceof BadRequestError) throw error
    throw new BadRequestError('invalid_json')
  }
}

class BadRequestError extends Error {}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function normalizeHost(host) {
  return typeof host === 'string' && host.length > 0 ? host : DEFAULT_HTTP_HOST
}

function normalizePort(port) {
  const parsed = Number(port)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid HTTP port: ${port}`)
  }
  return parsed
}
