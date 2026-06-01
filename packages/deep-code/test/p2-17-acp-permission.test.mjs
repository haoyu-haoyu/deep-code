import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildAcpTools } from '../src/cli/serve/acp/agentTurn.mjs'
import { createAcpServer } from '../src/cli/serve/acp/protocol.mjs'
import { createSessionRegistry } from '../src/cli/serve/sessions.mjs'
import { startAcpServer } from '../src/cli/serve/acp/index.mjs'

const tick = (ms = 10) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, timeout = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = fn()
    if (v) return v
    await tick(5)
  }
  throw new Error('waitFor timed out')
}

// --- the gate (buildAcpTools) ---------------------------------------------

test('buildAcpTools: read-only tools run freely; Edit is gated and denial blocks the write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-perm-'))
  writeFileSync(join(dir, 'f.txt'), 'old content here')
  try {
    let asked = null
    const updates = []
    const requestPermission = async tc => { asked = tc; return false } // deny
    const tools = buildAcpTools({ cwd: dir, onUpdate: u => updates.push(u), requestPermission })
    const read = tools.find(t => t.name === 'Read')
    const edit = tools.find(t => t.name === 'Edit')
    assert.ok(read && edit, 'full tool set includes Read + Edit')

    // Read (read-only): runs without requesting permission.
    await read.execute({ file_path: 'f.txt' }, { toolCall: { id: 'r1' } })
    assert.equal(asked, null, 'read-only tool must not request permission')

    // Edit (write): denied -> throws, asks first, emits failed, leaves file untouched.
    await assert.rejects(
      () => edit.execute({ file_path: 'f.txt', old_string: 'old', new_string: 'new' }, { toolCall: { id: 'e1' } }),
      /Permission denied/,
    )
    assert.equal(asked?.title, 'Edit')
    assert.equal(asked?.kind, 'edit')
    assert.ok(updates.some(u => u.toolCallId === 'e1' && u.status === 'failed'))
    assert.match(readFileSync(join(dir, 'f.txt'), 'utf8'), /old content here/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildAcpTools: an approved Edit actually writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-perm-'))
  writeFileSync(join(dir, 'f.txt'), 'old content')
  try {
    const edit = buildAcpTools({ cwd: dir, requestPermission: async () => true }).find(t => t.name === 'Edit')
    await edit.execute({ file_path: 'f.txt', old_string: 'old', new_string: 'NEW' }, { toolCall: { id: 'e' } })
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'NEW content')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildAcpTools: with NO approver, write tools are denied (deny-safe default)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-perm-'))
  writeFileSync(join(dir, 'f.txt'), 'x')
  try {
    const edit = buildAcpTools({ cwd: dir }).find(t => t.name === 'Edit') // no requestPermission
    await assert.rejects(
      () => edit.execute({ file_path: 'f.txt', old_string: 'x', new_string: 'y' }, { toolCall: { id: 'e' } }),
      /Permission denied/,
    )
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'x')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- dispatcher requestPermission outcome mapping -------------------------

function serverWithSendRequest(sendRequest) {
  const sent = []
  let captured
  const runTurn = async function* ({ requestPermission }) {
    captured = await requestPermission({ toolCallId: 't1', title: 'Edit', kind: 'edit', rawInput: {} })
    return 'end_turn'
  }
  const server = createAcpServer({ runTurn, sessions: createSessionRegistry(), send: m => sent.push(m), env: {}, sendRequest })
  return { server, sent, captured: () => captured }
}

test('dispatcher: requestPermission sends session/request_permission and maps "allow" -> true', async () => {
  const requests = []
  const { server, sent, captured } = serverWithSendRequest(async (method, params) => {
    requests.push({ method, params })
    return { outcome: { outcome: 'selected', optionId: 'allow' } }
  })
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = sent.at(-1).result.sessionId
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'x' } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'session/request_permission')
  assert.equal(requests[0].params.sessionId, sessionId)
  assert.ok(requests[0].params.options.some(o => o.optionId === 'allow'))
  assert.equal(captured(), true)
})

test('dispatcher: a rejected outcome, and a transport error, both map to false (deny)', async () => {
  const rejected = serverWithSendRequest(async () => ({ outcome: { outcome: 'selected', optionId: 'reject' } }))
  await rejected.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  await rejected.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: rejected.sent.at(-1).result.sessionId, prompt: 'x' } })
  assert.equal(rejected.captured(), false)

  const errored = serverWithSendRequest(async () => { throw new Error('disconnected') })
  await errored.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  await errored.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: errored.sent.at(-1).result.sessionId, prompt: 'x' } })
  assert.equal(errored.captured(), false)
})

// --- transport bidirectional round-trip -----------------------------------

function makeClient(runTurn) {
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
  const handle = startAcpServer({ stdin, stdout, runTurn })
  const send = o => stdin.write(JSON.stringify(o) + '\n')
  return { stdin, out, send, closed: handle.closed }
}

test('transport: session/request_permission request correlates with the client response', async () => {
  let outcome
  const runTurn = async function* ({ requestPermission }) {
    outcome = await requestPermission({ toolCallId: 't1', title: 'Edit', kind: 'edit', rawInput: {} })
    yield { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: outcome ? 'approved' : 'denied' } }
    return 'end_turn'
  }
  const { out, send } = makeClient(runTurn)
  send({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = (await waitFor(() => out.find(m => m.id === 1))).result.sessionId
  send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'edit' } })
  const req = await waitFor(() => out.find(m => m.method === 'session/request_permission'))
  assert.equal(req.params.sessionId, sessionId)
  assert.ok(req.id !== undefined && req.id !== null, 'permission request carries an id')
  // Client approves.
  send({ jsonrpc: '2.0', id: req.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } })
  await waitFor(() => out.find(m => m.id === 2))
  assert.equal(outcome, true)
  assert.ok(out.some(m => m.method === 'session/update' && m.params.update.content?.text === 'approved'))
})

test('transport: a pending permission request is denied when the client disconnects', async () => {
  let outcome = 'unset'
  const runTurn = async function* ({ requestPermission }) {
    outcome = await requestPermission({ toolCallId: 't1', title: 'Edit', kind: 'edit', rawInput: {} })
    return 'end_turn'
  }
  const { stdin, out, send } = makeClient(runTurn)
  send({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = (await waitFor(() => out.find(m => m.id === 1))).result.sessionId
  send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'edit' } })
  await waitFor(() => out.find(m => m.method === 'session/request_permission'))
  // Disconnect WITHOUT answering -> the pending request rejects -> requestPermission returns false.
  stdin.end()
  await waitFor(() => outcome !== 'unset')
  assert.equal(outcome, false)
})

test('SECURITY: a write is permitted ONLY on an exact selected+allow outcome', async () => {
  // Every malformed / edge / wrong-case permission response must DENY.
  const denyCases = [
    undefined,
    null,
    {},
    { outcome: {} },
    { outcome: { outcome: 'cancelled' } },
    { outcome: { outcome: 'selected', optionId: 'reject' } },
    { outcome: { outcome: 'allow' } }, // wrong shape (missing selected/optionId)
    { outcome: true },
    true,
    { outcome: { outcome: 'selected', optionId: 'ALLOW' } }, // case-sensitive
  ]
  for (const result of denyCases) {
    const s = serverWithSendRequest(async () => result)
    await s.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
    await s.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: s.sent.at(-1).result.sessionId, prompt: 'x' } })
    assert.equal(s.captured(), false, `must deny: ${JSON.stringify(result)}`)
  }
  // The one and only allow shape.
  const allow = serverWithSendRequest(async () => ({ outcome: { outcome: 'selected', optionId: 'allow' } }))
  await allow.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  await allow.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: allow.sent.at(-1).result.sessionId, prompt: 'x' } })
  assert.equal(allow.captured(), true)
})
