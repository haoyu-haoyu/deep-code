import { createServer } from 'node:http'

import {
  validateBearerToken,
  writeJson,
  writeUnauthorized,
} from './auth.mjs'

export const DEFAULT_HTTP_HOST = '127.0.0.1'
export const DEFAULT_HTTP_PORT = 8765

export async function startHttpServer({
  env = process.env,
  host = DEFAULT_HTTP_HOST,
  installSignalHandlers = true,
  port = DEFAULT_HTTP_PORT,
  processLike = process,
} = {}) {
  const normalizedHost = normalizeHost(host)
  const normalizedPort = normalizePort(port)
  const server = createServer((req, res) => {
    handleRequest(req, res, { env })
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

function handleRequest(req, res, { env }) {
  if (!validateBearerToken(req, { env })) {
    writeUnauthorized(res)
    return
  }

  writeJson(res, 404, { error: 'not_found' })
}

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
