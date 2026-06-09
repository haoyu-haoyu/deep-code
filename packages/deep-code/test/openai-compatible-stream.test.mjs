import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createOpenAICompatibleProvider,
  parseOpenAICompatibleStreamChunk,
  streamOpenAICompatibleQuery,
} from '../src/services/providers/openai-compatible.mjs'
import { collectDeepSeekStreamEvents } from '../src/services/providers/deepseek.mjs'

// ── OpenAI-compatible streamQuery (multi-provider unblock) ───────────────────
// streamQuery() was a `throw new Error('TODO ... scaffolded')`. It now fetches a
// /chat/completions endpoint and yields the same normalized stream-event
// vocabulary collectDeepSeekStreamEvents() assembles — because the OpenAI SSE
// wire format is the subset DeepSeek extends, the body parser is shared (DRY).

const enc = new TextEncoder()
const sse = obj => `data: ${JSON.stringify(obj)}\n\n`
// an async-iterable response body, as undici/fetch exposes via response.body
const bodyOf = (...lines) =>
  (async function* () {
    for (const line of lines) yield enc.encode(line)
  })()

const drain = async iter => {
  // eslint-disable-next-line no-empty
  for await (const _ of iter) {
  }
}

const provider = () =>
  createOpenAICompatibleProvider({
    providerName: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1/', // trailing slash must be trimmed
    apiKey: 'sk-test',
    defaultModel: 'gpt-x',
  })

// --- happy path: stream → normalized events → assembled response -------------

test('streamQuery builds the request and streams normalized events', async () => {
  let captured
  const fetch = async (url, opts) => {
    captured = { url, opts }
    return {
      ok: true,
      status: 200,
      body: bodyOf(
        sse({ choices: [{ delta: { content: 'Hel' } }] }),
        sse({ choices: [{ delta: { content: 'lo' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'ls', arguments: '{"p":' } },
                ],
              },
            },
          ],
        }),
        sse({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '"/"}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        sse({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }),
        'data: [DONE]\n\n',
      ),
    }
  }

  const events = []
  for await (const e of provider().streamQuery({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'ls' } }],
    fetch,
  })) {
    events.push(e)
  }

  // request shape: trailing slash trimmed, /chat/completions appended, auth set
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(captured.opts.method, 'POST')
  assert.equal(captured.opts.headers.Authorization, 'Bearer sk-test')
  const sent = JSON.parse(captured.opts.body)
  assert.equal(sent.model, 'gpt-x')
  assert.equal(sent.stream, true)
  assert.deepEqual(sent.stream_options, { include_usage: true }) // usage opt-in
  assert.equal(sent.tools.length, 1)
  assert.equal(sent.tool_choice, 'auto')

  // events flow through the shared parser
  assert.deepEqual(
    events.map(e => e.type),
    ['content_delta', 'content_delta', 'tool_call_delta', 'tool_call_delta', 'usage', 'done'],
  )

  // and assemble cleanly via the shared collector
  const collected = await collectDeepSeekStreamEvents(
    (async function* () {
      for (const e of events) yield e
    })(),
  )
  assert.equal(collected.content, 'Hello')
  assert.equal(collected.finishReason, 'tool_calls')
  assert.equal(collected.toolCalls.length, 1)
  assert.equal(collected.toolCalls[0].function.name, 'ls')
  assert.equal(collected.toolCalls[0].function.arguments, '{"p":"/"}') // accumulated
  assert.deepEqual(collected.usage, {
    prompt_tokens: 11,
    completion_tokens: 5,
    total_tokens: 16,
  })
})

// --- finish_reason bundled with the final content chunk ----------------------
// Many OpenAI-compatible servers attach finish_reason to the LAST content chunk
// (DeepSeek uses a trailing empty-delta chunk). The shared parser used to emit a
// finish event only when the chunk had NO content → a pure-text turn ended with
// finishReason undefined (stop_reason:null downstream). It must now fire.

test('streamQuery emits finish when finish_reason rides on the last content chunk', async () => {
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: bodyOf(
      sse({ choices: [{ delta: { content: 'Hello' } }] }),
      sse({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }), // bundled
      'data: [DONE]\n\n',
    ),
  })
  const events = []
  for await (const e of provider().streamQuery({ messages: [], fetch })) events.push(e)
  // a finish event is produced (after the content_delta), exactly once
  assert.deepEqual(
    events.map(e => e.type),
    ['content_delta', 'content_delta', 'finish', 'done'],
  )
  assert.equal(events.find(e => e.type === 'finish').finishReason, 'stop')

  const collected = await collectDeepSeekStreamEvents(
    (async function* () {
      for (const e of events) yield e
    })(),
  )
  assert.equal(collected.content, 'Hello world')
  assert.equal(collected.finishReason, 'stop') // was undefined before the fix
})

test('a tool-call chunk still carries finish on the tool_call_delta (no redundant finish event)', async () => {
  // finish_reason on a tool-call chunk rides on the tool_call_delta event; the
  // parser must NOT also emit a separate finish (would be redundant).
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: bodyOf(
      sse({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ls', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      'data: [DONE]\n\n',
    ),
  })
  const events = []
  for await (const e of provider().streamQuery({ messages: [], fetch })) events.push(e)
  assert.deepEqual(events.map(e => e.type), ['tool_call_delta', 'done']) // no separate finish
  assert.equal(events[0].finishReason, 'tool_calls')
})

// --- a malformed mid-stream line must not abort the whole stream (#317) -------

test('streamQuery survives a malformed data: line and keeps streaming', async () => {
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: bodyOf(
      sse({ choices: [{ delta: { content: 'A' } }] }),
      'data: {not valid json\n\n',
      sse({ choices: [{ delta: { content: 'B' } }] }),
      'data: [DONE]\n\n',
    ),
  })
  const collected = await collectDeepSeekStreamEvents(
    provider().streamQuery({ messages: [], fetch }),
  )
  assert.equal(collected.content, 'AB')
})

test('parseOpenAICompatibleStreamChunk fail-softs a malformed data: line instead of throwing', () => {
  // a well-formed data line parses to its object
  assert.deepEqual(
    parseOpenAICompatibleStreamChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n'),
    { choices: [{ delta: { content: 'hi' } }] },
  )
  // [DONE], empty payload, and a chunk with no data: line all yield null
  assert.equal(parseOpenAICompatibleStreamChunk('data: [DONE]\n'), null)
  assert.equal(parseOpenAICompatibleStreamChunk('data:\n'), null)
  assert.equal(parseOpenAICompatibleStreamChunk(': keepalive\n\n'), null)

  // a malformed / truncated JSON payload must NOT throw — it returns null (matching the
  // DeepSeek twin's fail-soft contract; previously this was an unguarded JSON.parse).
  assert.doesNotThrow(() => parseOpenAICompatibleStreamChunk('data: {not valid json\n'))
  assert.equal(parseOpenAICompatibleStreamChunk('data: {truncated'), null)

  // and a malformed line followed by a valid one skips the bad line and returns the valid
  // chunk, rather than aborting on the first failure
  assert.deepEqual(
    parseOpenAICompatibleStreamChunk('data: {bad\ndata: {"choices":[]}\n'),
    { choices: [] },
  )

  // the public provider.parseStreamChunk method (which delegates here) also no longer throws
  assert.doesNotThrow(() => provider().parseStreamChunk('data: {still bad\n'))
})

// --- providers without an API key send no Authorization header ----------------

test('streamQuery omits Authorization when the provider has no API key', async () => {
  let captured
  const fetch = async (url, opts) => {
    captured = opts
    return { ok: true, status: 200, body: bodyOf('data: [DONE]\n\n') }
  }
  const ollama = createOpenAICompatibleProvider({ providerName: 'ollama' })
  // drain
  // eslint-disable-next-line no-empty
  for await (const _ of ollama.streamQuery({ messages: [], model: 'llama3.1', fetch })) {
  }
  assert.equal(captured.headers.Authorization, undefined)
})

// --- a non-2xx response throws with status + body detail ----------------------

test('streamQuery throws a detailed error on a non-ok response', async () => {
  const fetch = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    text: async () => 'rate limited',
    body: bodyOf(),
  })
  await assert.rejects(
    async () => {
      for await (const _ of provider().streamQuery({ messages: [], fetch })) {
        // unreachable
      }
    },
    /429 Too Many Requests — rate limited/,
  )
})

// --- a pre-built request object bypasses buildRequest -------------------------

test('streamQuery accepts a pre-built request (url+method+headers+body)', async () => {
  let captured
  const fetch = async (url, opts) => {
    captured = { url, opts }
    return { ok: true, status: 200, body: bodyOf('data: [DONE]\n\n') }
  }
  const request = {
    url: 'https://direct.example/v1/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [] }),
    fetch,
  }
  // eslint-disable-next-line no-empty
  for await (const _ of provider().streamQuery(request)) {
  }
  assert.equal(captured.url, 'https://direct.example/v1/chat/completions')
  assert.equal(captured.opts.body, request.body) // passed verbatim, not rebuilt
})

test('streamQuery routes a pre-built request by key presence, not truthiness', async () => {
  let captured
  const fetch = async (url, opts) => {
    captured = opts
    return { ok: true, status: 200, body: bodyOf('data: [DONE]\n\n') }
  }
  // a falsy ('') body must STILL be treated as a pre-built request, not rerouted
  // through buildRequest (which would silently replace it with a JSON payload).
  const request = {
    url: 'https://direct.example/v1/chat/completions',
    method: 'POST',
    headers: {},
    body: '',
    fetch,
  }
  // eslint-disable-next-line no-empty
  for await (const _ of provider().streamQuery(request)) {
  }
  assert.equal(captured.body, '') // verbatim empty body — buildRequest NOT invoked
})

test('streamQuery prefers buildRequest when an object carries both shapes keys', async () => {
  let captured
  const fetch = async (url, opts) => {
    captured = { url, opts }
    return { ok: true, status: 200, body: bodyOf('data: [DONE]\n\n') }
  }
  // a half-merged object that has buildRequest inputs (messages/model) AND
  // stray request keys must build (using the provider baseUrl), NOT fetch the
  // stray url with the stray body.
  await drain(
    provider().streamQuery({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-x',
      url: 'https://stray.example/chat/completions',
      method: 'POST',
      headers: {},
      body: 'junk',
      fetch,
    }),
  )
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions') // provider baseUrl
  assert.notEqual(captured.opts.body, 'junk') // built, not the stray body
})

// --- the caller's abort signal is forwarded onto the fetch controller ---------

test('streamQuery forwards an already-aborted caller signal to fetch', async () => {
  const ac = new AbortController()
  ac.abort()
  let seen
  const fetch = async (url, opts) => {
    seen = opts.signal
    return { ok: true, status: 200, body: bodyOf('data: [DONE]\n\n') }
  }
  // eslint-disable-next-line no-empty
  for await (const _ of provider().streamQuery({ messages: [], fetch, signal: ac.signal })) {
  }
  assert.equal(seen.aborted, true)
})

test('streamQuery forwards a mid-stream caller abort to fetch', async () => {
  const ac = new AbortController()
  let seen
  const fetch = async (url, opts) => {
    seen = opts.signal
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        yield enc.encode(sse({ choices: [{ delta: { content: 'x' } }] }))
        ac.abort() // caller cancels mid-stream
        yield enc.encode('data: [DONE]\n\n')
      })(),
    }
  }
  // eslint-disable-next-line no-empty
  for await (const _ of provider().streamQuery({ messages: [], fetch, signal: ac.signal })) {
  }
  assert.equal(seen.aborted, true) // controller.abort() fired via the forwarded listener
})

// --- a request timeout aborts and surfaces a timeout error --------------------

test('streamQuery times out and reports the elapsed budget', async () => {
  // a fetch that only settles when its signal aborts — mimics a hung endpoint.
  // The ref'd keep-alive timer holds the event loop open so the (unref'd)
  // production timeout timer can actually fire in this isolated test.
  const fetch = (url, opts) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('server gave up')), 1000)
      opts.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(keepAlive)
          reject(new Error('aborted'))
        },
        { once: true },
      )
    })
  await assert.rejects(
    async () => {
      for await (const _ of streamOpenAICompatibleQuery(
        { url: 'https://slow.example/v1/chat/completions', method: 'POST', headers: {}, body: '{}' },
        { fetch, requestTimeoutMs: 5 },
      )) {
        // unreachable
      }
    },
    /timed out after 5ms/,
  )
})
