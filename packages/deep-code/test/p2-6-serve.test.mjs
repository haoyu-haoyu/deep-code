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

test('POST /sessions creates a session and GET returns its details', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const cwd = '/tmp/deepcode-http-session'
    const createResponse = await request(server, {
      body: { cwd },
      method: 'POST',
      path: '/sessions',
      token: TOKEN,
    })
    const created = await createResponse.json()

    assert.equal(createResponse.status, 200)
    assert.match(created.session_id, UUID_PATTERN)

    const getResponse = await request(server, {
      path: `/sessions/${created.session_id}`,
      token: TOKEN,
    })
    const session = await getResponse.json()

    assert.equal(getResponse.status, 200)
    assert.equal(session.id, created.session_id)
    assert.equal(session.cwd, cwd)
    assert.equal(session.state, 'idle')
    assert.equal(session.turn_count, 0)
    assert.equal(session.active_turn_id, null)
    assert.equal(typeof session.created_at, 'number')
    assert.equal(typeof session.updated_at, 'number')
  })
})

test('DELETE /sessions/:id removes a session and subsequent GET returns 404', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const createResponse = await request(server, {
      method: 'POST',
      path: '/sessions',
      token: TOKEN,
    })
    const { session_id: sessionId } = await createResponse.json()

    const deleteResponse = await request(server, {
      method: 'DELETE',
      path: `/sessions/${sessionId}`,
      token: TOKEN,
    })
    assert.equal(deleteResponse.status, 204)

    const getResponse = await request(server, {
      path: `/sessions/${sessionId}`,
      token: TOKEN,
    })
    assert.equal(getResponse.status, 404)
  })
})

test('POST /sessions returns 400 on bad JSON body', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const response = await fetch(`http://127.0.0.1:${server.port}/sessions`, {
      body: '{bad json',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    assert.equal(response.status, 400)
  })
})

test('sessions CRUD routes require auth', async () => {
  await withServer({ env: { DEEPCODE_HTTP_TOKEN: TOKEN } }, async server => {
    const response = await request(server, {
      method: 'POST',
      path: '/sessions',
    })

    assert.equal(response.status, 401)
  })
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

function request(
  server,
  { body, method = 'GET', path = '/', token } = {},
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  })
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
