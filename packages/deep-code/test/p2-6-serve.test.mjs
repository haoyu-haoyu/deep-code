import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { startHttpServer } from '../src/cli/serve/http.mjs'

const TOKEN = 'testtoken123'
const WRONG_TOKEN = 'wrongtoken456'

test('serve http returns 401 when DEEPCODE_HTTP_TOKEN is missing', async () => {
  await withServer({ env: {} }, async server => {
    const response = await request(server, { token: TOKEN })
    const body = await response.text()

    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer\b/)
    assert.equal(body.includes(TOKEN), false)
  })
})

test('serve http returns 401 for wrong Bearer token without echoing secrets', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const response = await request(server, { token: WRONG_TOKEN })
    const body = await response.text()

    assert.equal(response.status, 401)
    assert.equal(body.includes(TOKEN), false)
    assert.equal(body.includes(WRONG_TOKEN), false)
  })
})

test('serve http lets correct Bearer token reach the 404 route fallback', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const response = await request(server, { token: TOKEN })
    const body = await response.text()

    assert.equal(response.status, 404)
    assert.equal(body.includes(TOKEN), false)
  })
})

test('serve http defaults to localhost binding', async () => {
  const server = await startHttpServer({
    env: { DEEPCODE_HTTP_TOKEN: TOKEN },
    installSignalHandlers: false,
    port: 0,
  })

  try {
    const address = server.server.address()

    assert.equal(server.host, '127.0.0.1')
    assert.equal(typeof address, 'object')
    assert.equal(address.address, '127.0.0.1')
  } finally {
    await server.close()
  }
})

test('serve http closes cleanly when SIGTERM is emitted', async () => {
  const processLike = new EventEmitter()
  const server = await startHttpServer({
    env: { DEEPCODE_HTTP_TOKEN: TOKEN },
    port: 0,
    processLike,
  })

  processLike.emit('SIGTERM')
  await server.closed

  assert.equal(server.server.listening, false)
})

async function withServer(options, fn) {
  const server = await startHttpServer({
    installSignalHandlers: false,
    port: 0,
    ...options,
  })

  try {
    await fn(server)
  } finally {
    await server.close()
  }
}

function request(server, { token }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return fetch(`http://127.0.0.1:${server.port}/`, { headers })
}
