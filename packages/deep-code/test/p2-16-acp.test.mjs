import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { startAcpServer } from '../src/cli/serve/acp/index.mjs'

import {
  ACP_PROTOCOL_VERSION,
  buildInitializeResult,
  createAcpServer,
  encodeMessage,
  extractPromptText,
  mapRuntimeEventToAcp,
  mapStopReason,
  negotiateProtocolVersion,
  parseJsonRpcChunk,
} from '../src/cli/serve/acp/protocol.mjs'
import { createSessionRegistry } from '../src/cli/serve/sessions.mjs'

// --- framing --------------------------------------------------------------

test('encodeMessage / parseJsonRpcChunk round-trip newline-delimited JSON-RPC', () => {
  const msg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
  const line = encodeMessage(msg)
  assert.equal(line.endsWith('\n'), true)
  assert.equal(line.includes('\n', 0), true)
  const { messages, rest } = parseJsonRpcChunk(line)
  assert.deepEqual(messages, [msg])
  assert.equal(rest, '')
})

test('parseJsonRpcChunk buffers a partial trailing line and surfaces malformed lines', () => {
  const a = parseJsonRpcChunk('{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,')
  assert.equal(a.messages.length, 1)
  assert.equal(a.messages[0].id, 1)
  assert.equal(a.rest, '{"jsonrpc":"2.0","id":2,')
  assert.deepEqual(a.malformed, [])
  // Completing the partial line on the next chunk yields the second message; a
  // complete-but-unparseable line is reported as malformed (not silently lost).
  const b = parseJsonRpcChunk(a.rest + '"method":"b"}\nnot json\n{"jsonrpc":"2.0","id":3}')
  assert.deepEqual(b.messages.map(m => m.id ?? m.method), [2]) // id:3 is still partial
  assert.deepEqual(b.malformed, ['not json'])
  assert.equal(b.rest, '{"jsonrpc":"2.0","id":3}')
})

test('mapStopReason maps runtime/provider finish reasons to the ACP enum', () => {
  assert.equal(mapStopReason('stop'), 'end_turn')
  assert.equal(mapStopReason('tool_calls'), 'end_turn')
  assert.equal(mapStopReason('length'), 'max_tokens')
  assert.equal(mapStopReason('max_tokens'), 'max_tokens')
  assert.equal(mapStopReason('content_filter'), 'refusal')
  assert.equal(mapStopReason(undefined), 'end_turn')
})

// --- initialize negotiation ----------------------------------------------

test('negotiateProtocolVersion returns the lesser of client and agent versions', () => {
  assert.equal(ACP_PROTOCOL_VERSION, 1)
  assert.equal(negotiateProtocolVersion(1), 1)
  assert.equal(negotiateProtocolVersion(99), 1)
  assert.equal(negotiateProtocolVersion(0), 0)
  assert.equal(negotiateProtocolVersion(undefined), 1)
  assert.equal(negotiateProtocolVersion(-3), 1)
})

test('buildInitializeResult advertises a text-only read-only agent', () => {
  const result = buildInitializeResult({ protocolVersion: 1 })
  assert.equal(result.protocolVersion, 1)
  assert.equal(result.agentCapabilities.loadSession, false)
  assert.deepEqual(result.agentCapabilities.promptCapabilities, {
    image: false,
    audio: false,
    embeddedContext: false,
  })
  assert.deepEqual(result.authMethods, [])
})

// --- prompt extraction + event mapping -----------------------------------

test('extractPromptText flattens text and resource_link content blocks', () => {
  assert.equal(extractPromptText([{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }]), 'hello world')
  assert.equal(extractPromptText('plain'), 'plain')
  assert.equal(extractPromptText([{ type: 'image', data: 'x' }]), '')
  assert.equal(extractPromptText(undefined), '')
  // Baseline resource_link blocks (editor @-mentions) are kept as a reference.
  assert.equal(
    extractPromptText([{ type: 'text', text: 'fix ' }, { type: 'resource_link', name: 'a.ts', uri: 'file:///a.ts' }]),
    'fix @a.ts (file:///a.ts)',
  )
})

test('mapRuntimeEventToAcp maps text/reasoning/tool_use and ignores the rest', () => {
  assert.deepEqual(
    mapRuntimeEventToAcp({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
  )
  assert.deepEqual(
    mapRuntimeEventToAcp({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } },
  )
  const toolCall = mapRuntimeEventToAcp({
    type: 'content_block_start',
    contentBlock: { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } },
  })
  assert.equal(toolCall.sessionUpdate, 'tool_call')
  assert.equal(toolCall.toolCallId, 't1')
  assert.equal(toolCall.title, 'Read')
  assert.equal(toolCall.status, 'pending')
  assert.deepEqual(toolCall.rawInput, { path: 'a' })
  // Ignored events.
  assert.equal(mapRuntimeEventToAcp({ type: 'message_start' }), null)
  assert.equal(mapRuntimeEventToAcp({ type: 'content_block_stop', index: 0 }), null)
  assert.equal(mapRuntimeEventToAcp(null), null)
})

// --- dispatcher -----------------------------------------------------------

function makeServer(runTurn) {
  const sent = []
  const sessions = createSessionRegistry({ defaultCwd: () => '/repo' })
  const server = createAcpServer({ runTurn, sessions, send: m => sent.push(m), env: {} })
  return { server, sent, sessions }
}

test('createAcpServer validates its collaborators', () => {
  assert.throws(() => createAcpServer({ sessions: {}, send() {} }), /runTurn/)
  assert.throws(() => createAcpServer({ runTurn() {}, send() {} }), /session registry/)
  assert.throws(() => createAcpServer({ runTurn() {}, sessions: createSessionRegistry() }), /send/)
})

test('initialize + session/new respond with the negotiated version and a session id', async () => {
  const { server, sent } = makeServer(async function* () {})
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/repo' } })
  assert.equal(sent[0].result.protocolVersion, 1)
  assert.ok(typeof sent[1].result.sessionId === 'string' && sent[1].result.sessionId.length > 0)
})

test('session/prompt streams session/update notifications and returns end_turn', async () => {
  const updates = [
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'planning' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '42' } },
  ]
  const { server, sent } = makeServer(async function* () {
    for (const u of updates) yield u
  })
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = sent.at(-1).result.sessionId
  await server.handleMessage({
    jsonrpc: '2.0', id: 2, method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text: 'what is 6*7?' }] },
  })
  const notifications = sent.filter(m => m.method === 'session/update')
  assert.equal(notifications.length, 2)
  assert.equal(notifications[0].params.update.sessionUpdate, 'agent_thought_chunk')
  assert.equal(notifications[1].params.update.content.text, '42')
  assert.equal(notifications.every(n => n.params.sessionId === sessionId), true)
  const response = sent.find(m => m.id === 2)
  assert.deepEqual(response.result, { stopReason: 'end_turn' })
})

test('session/prompt reports the runtime stop reason (length -> max_tokens)', async () => {
  const { server, sent } = makeServer(async function* () {
    yield { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a long answer' } }
    return 'length' // runtime/provider finish reason
  })
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = sent.at(-1).result.sessionId
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'go' } })
  assert.deepEqual(sent.find(m => m.id === 2).result, { stopReason: 'max_tokens' })
})

test('session/cancel aborts the in-flight turn and the prompt resolves with cancelled', async () => {
  let abortSignal
  const { server, sent } = makeServer(async function* ({ signal }) {
    abortSignal = signal
    yield { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working' } }
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  })
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = sent.at(-1).result.sessionId
  const promptDone = server.handleMessage({
    jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'go' },
  })
  // Let the turn start + emit its first chunk, then cancel.
  await new Promise(r => setTimeout(r, 10))
  await server.handleMessage({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
  await promptDone
  assert.equal(abortSignal.aborted, true)
  assert.deepEqual(sent.find(m => m.id === 2).result, { stopReason: 'cancelled' })
})

test('prompt on an unknown session and unknown methods return JSON-RPC errors', async () => {
  const { server, sent } = makeServer(async function* () {})
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: 'nope', prompt: 'x' } })
  assert.equal(sent[0].error.code, -32602)
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'no/such/method' })
  assert.equal(sent[1].error.code, -32601)
  // Notifications (no id) never produce a response.
  sent.length = 0
  await server.handleMessage({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'x' } })
  assert.equal(sent.length, 0)
})

// --- transport shutdown (no truncation on half-close) ---------------------

test('startAcpServer waits for an in-flight prompt before closing (no truncation)', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const out = []
  let obuf = ''
  stdout.on('data', d => {
    obuf += d.toString()
    let i
    while ((i = obuf.indexOf('\n')) >= 0) {
      const line = obuf.slice(0, i).trim()
      obuf = obuf.slice(i + 1)
      if (line) out.push(JSON.parse(line))
    }
  })
  let releaseGate
  const gate = new Promise(r => { releaseGate = r })
  // A prompt that streams one chunk, then blocks until the gate is released.
  const runTurn = async function* () {
    yield { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } }
    await gate
    return 'stop'
  }
  const { closed } = startAcpServer({ stdin, stdout, runTurn })

  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/new' }) + '\n')
  await new Promise(r => setTimeout(r, 15))
  const sessionId = out.find(m => m.id === 1).result.sessionId
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'go' } }) + '\n')
  await new Promise(r => setTimeout(r, 15))

  // Half-close stdin WHILE the prompt is gated (in flight).
  stdin.end()
  let closedResolved = false
  closed.then(() => { closedResolved = true })
  await new Promise(r => setTimeout(r, 25))
  assert.equal(closedResolved, false, 'closed must wait for the in-flight prompt')
  assert.equal(out.find(m => m.id === 2), undefined, 'prompt response not sent before the turn finishes')

  // Release: the prompt finishes, writes its response, then closed resolves.
  releaseGate()
  await closed
  assert.deepEqual(out.find(m => m.id === 2).result, { stopReason: 'end_turn' })
  assert.ok(out.some(m => m.method === 'session/update' && m.params.update.content?.text === 'partial'))
})
