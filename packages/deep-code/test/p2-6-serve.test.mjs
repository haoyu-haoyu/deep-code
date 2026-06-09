import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { startHttpServer } from '../src/cli/serve/http.mjs'
import { encodeSseEvent } from '../src/cli/serve/sse.mjs'
import {
  readBearerToken,
  timingSafeTokenEquals,
  validateBearerToken,
} from '../src/cli/serve/auth.mjs'

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

test('POST /sessions/:id/turns streams fake runner events over SSE', async () => {
  const turnRunner = async function* () {
    yield { text: 'hello', type: 'text_delta' }
    yield { name: 'Read', type: 'tool_call' }
    yield { content: 'ok', type: 'tool_result' }
  }

  await withServer(
    { env: { DEEPCODE_HTTP_TOKEN: TOKEN }, turnRunner },
    async server => {
      const sessionId = await createSession(server)
      const response = await request(server, {
        body: { prompt: 'stream please' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })
      const frames = parseSseFrames(await response.text())

      assert.equal(response.status, 200)
      assert.match(
        response.headers.get('content-type') ?? '',
        /^text\/event-stream\b/,
      )
      assert.deepEqual(
        frames.map(frame => frame.event),
        ['text_delta', 'tool_call', 'tool_result', 'final'],
      )
      assert.deepEqual(
        frames.map(frame => frame.data.sequence),
        [1, 2, 3, 4],
      )
      assert.equal(frames.at(-1).data.turn_id, 1)
      assert.equal(frames.at(-1).data.status, 'completed')
    },
  )
})

test('GET /sessions/:id/turns/:turn_id returns turn status', async () => {
  const turnRunner = async function* () {
    yield { text: 'done', type: 'text_delta' }
  }

  await withServer(
    { env: { DEEPCODE_HTTP_TOKEN: TOKEN }, turnRunner },
    async server => {
      const sessionId = await createSession(server)
      const response = await request(server, {
        body: { prompt: 'status please' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })
      await response.text()

      const statusResponse = await request(server, {
        path: `/sessions/${sessionId}/turns/1`,
        token: TOKEN,
      })
      const status = await statusResponse.json()

      assert.equal(statusResponse.status, 200)
      assert.equal(status.id, 1)
      assert.equal(status.session_id, sessionId)
      assert.equal(status.status, 'completed')
      assert.equal(typeof status.started_at, 'number')
      assert.equal(typeof status.completed_at, 'number')
    },
  )
})

test('concurrent turn submission for the same session returns 409', async () => {
  const turnRunner = async function* ({ signal }) {
    yield { text: 'started', type: 'text_delta' }
    await waitForAbort(signal)
  }

  await withServer(
    { env: { DEEPCODE_HTTP_TOKEN: TOKEN }, turnRunner },
    async server => {
      const sessionId = await createSession(server)
      const firstResponse = await request(server, {
        body: { prompt: 'first' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })

      const secondResponse = await request(server, {
        body: { prompt: 'second' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })

      assert.equal(firstResponse.status, 200)
      assert.equal(secondResponse.status, 409)

      await request(server, {
        method: 'DELETE',
        path: `/sessions/${sessionId}`,
        token: TOKEN,
      })
      await firstResponse.text()
    },
  )
})

test('DELETE /sessions/:id aborts an active streamed turn', async () => {
  let sawAbort = false
  const turnRunner = async function* ({ signal }) {
    yield { text: 'started', type: 'text_delta' }
    await waitForAbort(signal)
    sawAbort = true
  }

  await withServer(
    { env: { DEEPCODE_HTTP_TOKEN: TOKEN }, turnRunner },
    async server => {
      const sessionId = await createSession(server)
      const response = await request(server, {
        body: { prompt: 'cancel me' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })

      const deleteResponse = await request(server, {
        method: 'DELETE',
        path: `/sessions/${sessionId}`,
        token: TOKEN,
      })
      const frames = parseSseFrames(await response.text())

      assert.equal(response.status, 200)
      assert.equal(deleteResponse.status, 204)
      assert.equal(sawAbort, true)
      assert.equal(frames.at(-1).event, 'error')
      assert.equal(frames.at(-1).data.status, 'aborted')
    },
  )
})

test('client disconnect aborts a streamed turn without crashing', async () => {
  let sawAbort = false
  const turnRunner = async function* ({ signal }) {
    yield { text: 'started', type: 'text_delta' }
    await waitForAbort(signal)
    sawAbort = true
  }

  await withServer(
    { env: { DEEPCODE_HTTP_TOKEN: TOKEN }, turnRunner },
    async server => {
      const sessionId = await createSession(server)
      const response = await request(server, {
        body: { prompt: 'disconnect me' },
        method: 'POST',
        path: `/sessions/${sessionId}/turns`,
        token: TOKEN,
      })

      assert.equal(response.status, 200)
      void response.body.cancel().catch(() => {})
      await waitFor(() => sawAbort)
    },
  )
})

test('serve --acp starts a JSON-RPC stdio server and answers initialize', () => {
  const init =
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n'
  const result = runServeModeInChild('{ acp: true }', { input: init })

  assert.equal(result.status, 0, result.stderr)
  const messages = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const response = messages.find(m => m.id === 1)
  assert.ok(response, `expected an initialize response, got: ${result.stdout}`)
  assert.equal(response.result.protocolVersion, 1)
  assert.equal(response.result.agentCapabilities.loadSession, false)
  assert.equal(result.stderr.includes(TOKEN), false)
})

test('serve --acp with --http starts ACP (not the HTTP server)', async () => {
  const port = await getUnusedPort()
  // ACP wins over --http; with stdin closed immediately it starts then exits 0,
  // and never binds the HTTP port.
  const result = runServeModeInChild(
    `{ acp: true, http: true, host: '127.0.0.1', port: ${port} }`,
  )

  assert.equal(result.status, 0, result.stderr)
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(100),
    }),
  )
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
  { body, method = 'GET', path = '/', signal, token } = {},
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
    signal,
  })
}

async function createSession(server) {
  const response = await request(server, {
    method: 'POST',
    path: '/sessions',
    token: TOKEN,
  })
  const body = await response.json()
  return body.session_id
}

function parseSseFrames(text) {
  return text
    .split('\n\n')
    .filter(frame => frame.trim().length > 0 && !frame.startsWith(':'))
    .map(frame => {
      const result = {}
      const data = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) result.event = line.slice(7)
        if (line.startsWith('id: ')) result.id = line.slice(4)
        if (line.startsWith('data: ')) data.push(line.slice(6))
      }
      result.data = JSON.parse(data.join('\n'))
      return result
    })
}

function waitForAbort(signal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', resolve, {
    once: true,
  }))
}

async function waitFor(predicate, { attempts = 50, interval = 10 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await delay(interval)
  }
  assert.fail('condition not met before timeout')
}

function runServeModeInChild(optionsSource, { input } = {}) {
  const script = `
    import { startServeMode } from './src/cli/serve/index.mjs'
    await startServeMode(${optionsSource})
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_HTTP_TOKEN: TOKEN,
    },
    input,
    timeout: 5000,
  })
}

async function getUnusedPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  return port
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── encodeSseEvent: the SSE wire-format encoder. Its multiline / CRLF / id:0
// branches are exercised only indirectly via the HTTP server; pin them directly.
test('encodeSseEvent emits one data: line per payload line and always ends with a blank line', () => {
  // single-line string: just one data: line + the terminating blank line
  assert.equal(encodeSseEvent({ data: 'hello' }), 'data: hello\n\n')

  // event + id are emitted before the data, in order
  assert.equal(
    encodeSseEvent({ data: 'x', event: 'ping', id: 7 }),
    'event: ping\nid: 7\ndata: x\n\n',
  )

  // id === 0 is INCLUDED (the guard is `id !== undefined`, not truthiness) — a 0 sequence
  // number must still be wire-encoded.
  assert.equal(encodeSseEvent({ data: 'x', id: 0 }), 'id: 0\ndata: x\n\n')

  // a multiline payload becomes one `data:` line per line (SSE requires this; a raw
  // newline inside a single data field would otherwise terminate the event early).
  assert.equal(encodeSseEvent({ data: 'a\nb\nc' }), 'data: a\ndata: b\ndata: c\n\n')

  // CRLF is normalized to per-line data: fields with no stray '\r' (split is /\r?\n/).
  assert.equal(encodeSseEvent({ data: 'a\r\nb' }), 'data: a\ndata: b\n\n')

  // a non-string payload is JSON-stringified (single line for compact JSON)
  assert.equal(encodeSseEvent({ data: { x: 1, y: 'z' } }), 'data: {"x":1,"y":"z"}\n\n')

  // a falsy/absent event is omitted (only `if (event)` adds the line)
  assert.equal(encodeSseEvent({ data: 'x', event: '' }), 'data: x\n\n')
})

// ── auth helpers: the Bearer-token reader and constant-time comparison. The
// length-mismatch padding branch and the empty/format edges are not covered by the
// integration tests; pin them directly.
test('readBearerToken extracts only a well-formed Bearer token', () => {
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123')
  // everything after the first 'Bearer ' is the token (including spaces)
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer a b' } }), 'a b')
  // missing / non-string / wrong scheme / empty token → null
  assert.equal(readBearerToken({ headers: {} }), null)
  assert.equal(readBearerToken({ headers: { authorization: 123 } }), null)
  assert.equal(readBearerToken({ headers: { authorization: 'Basic abc' } }), null)
  assert.equal(readBearerToken({ headers: { authorization: 'bearer abc' } }), null) // case-sensitive
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer ' } }), null) // empty token
})

test('timingSafeTokenEquals is true only for an exact match, false on any length/content mismatch', () => {
  assert.equal(timingSafeTokenEquals('secret', 'secret'), true)
  assert.equal(timingSafeTokenEquals('secret', 'secres'), false) // same length, different content
  // length mismatch (the padding branch) — both orderings, and the empty-vs-nonempty edge
  assert.equal(timingSafeTokenEquals('short', 'longer-token'), false)
  assert.equal(timingSafeTokenEquals('longer-token', 'short'), false)
  assert.equal(timingSafeTokenEquals('', 'x'), false)
  assert.equal(timingSafeTokenEquals('', ''), true)
})

test('validateBearerToken gates on a configured token matching the request Bearer', () => {
  const reqWith = token => ({ headers: { authorization: `Bearer ${token}` } })
  // no configured token → always false (never accept when the server has no token set)
  assert.equal(validateBearerToken(reqWith('anything'), { env: {} }), false)
  // configured token, matching / wrong / missing request token
  const env = { DEEPCODE_HTTP_TOKEN: 'sk-serve-123' }
  assert.equal(validateBearerToken(reqWith('sk-serve-123'), { env }), true)
  assert.equal(validateBearerToken(reqWith('sk-wrong'), { env }), false)
  assert.equal(validateBearerToken({ headers: {} }, { env }), false)
})
