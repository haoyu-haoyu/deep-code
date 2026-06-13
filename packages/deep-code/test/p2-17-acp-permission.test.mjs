import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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
  const offered = requests[0].params.options.map(o => o.optionId)
  assert.ok(offered.includes('allow_once') && offered.includes('allow_always'), 'offers allow_once + allow_always')
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

test('transport: session/cancel rejects a pending permission request PROMPTLY (no 300s hang)', async () => {
  let outcome = 'unset'
  const runTurn = async function* ({ requestPermission }) {
    // Blocks on the editor's permission answer, which never comes — only the
    // cancel can unblock it.
    outcome = await requestPermission({ toolCallId: 't1', title: 'Edit', kind: 'edit', rawInput: {} })
    return 'end_turn'
  }
  const { out, send } = makeClient(runTurn)
  send({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const sessionId = (await waitFor(() => out.find(m => m.id === 1))).result.sessionId
  send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'edit' } })
  await waitFor(() => out.find(m => m.method === 'session/request_permission'))
  // Cancel WITHOUT answering. Pre-fix the permission round-trip would hang until
  // the 300s request timeout; the turn's signal must reject it promptly → deny.
  send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
  await waitFor(() => outcome !== 'unset') // default 2s waitFor — far under 300s
  assert.equal(outcome, false)
  // and the prompt reply lands (turn ends), not left dangling.
  await waitFor(() => out.find(m => m.id === 2))
})

test('SECURITY: a write is permitted ONLY on an exact selected + allow* outcome', async () => {
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
    { outcome: { outcome: 'selected', optionId: 'allow_forever' } }, // not a real optionId
    { outcome: { outcome: 'allowed', optionId: 'allow' } }, // outcome must be exactly 'selected'
  ]
  for (const result of denyCases) {
    const s = serverWithSendRequest(async () => result)
    await s.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
    await s.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: s.sent.at(-1).result.sessionId, prompt: 'x' } })
    assert.equal(s.captured(), false, `must deny: ${JSON.stringify(result)}`)
  }
  // The allow shapes — and ONLY these — grant the write.
  for (const optionId of ['allow', 'allow_once', 'allow_always']) {
    const allow = serverWithSendRequest(async () => ({ outcome: { outcome: 'selected', optionId } }))
    await allow.server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
    await allow.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: allow.sent.at(-1).result.sessionId, prompt: 'x' } })
    assert.equal(allow.captured(), true, `must allow: ${optionId}`)
  }
})

// --- allow_always: session-scoped permission memory -----------------------

// Drive N requestPermission calls (with the given tool titles) in one turn and
// report each outcome plus how many times the editor was actually prompted.
function serverWithPermissionProbe(sendRequest, titles) {
  const sent = []
  const outcomes = []
  const runTurn = async function* ({ requestPermission }) {
    for (const title of titles) {
      outcomes.push(await requestPermission({ toolCallId: title, title, kind: 'edit', rawInput: {} }))
    }
    return 'end_turn'
  }
  const server = createAcpServer({ runTurn, sessions: createSessionRegistry(), send: m => sent.push(m), env: {}, sendRequest })
  const runOnce = async () => {
    await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
    const sessionId = sent.at(-1).result.sessionId
    await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: 'x' } })
    return sessionId
  }
  return { server, sent, outcomes, runOnce }
}

test('dispatcher: allow_always is remembered — the second call of that tool auto-approves without re-prompting', async () => {
  let prompts = 0
  const probe = serverWithPermissionProbe(async () => { prompts++; return { outcome: { outcome: 'selected', optionId: 'allow_always' } } }, ['Edit', 'Edit', 'Edit'])
  await probe.runOnce()
  assert.deepEqual(probe.outcomes, [true, true, true])
  assert.equal(prompts, 1, 'only the first Edit prompts the editor; the rest are remembered')
})

test('dispatcher: allow_always is scoped to the tool name — a different tool still prompts', async () => {
  let prompts = 0
  const probe = serverWithPermissionProbe(async () => { prompts++; return { outcome: { outcome: 'selected', optionId: 'allow_always' } } }, ['Edit', 'Write'])
  await probe.runOnce()
  assert.deepEqual(probe.outcomes, [true, true])
  assert.equal(prompts, 2, 'Write is a different tool, so it is not covered by the Edit grant')
})

test('dispatcher: allow_once does NOT persist — the next call prompts again', async () => {
  let prompts = 0
  const probe = serverWithPermissionProbe(async () => { prompts++; return { outcome: { outcome: 'selected', optionId: 'allow_once' } } }, ['Edit', 'Edit'])
  await probe.runOnce()
  assert.deepEqual(probe.outcomes, [true, true])
  assert.equal(prompts, 2, 'allow_once is single-use, so each call re-prompts')
})

test('dispatcher: an allow_always grant in one session does NOT leak to another session', async () => {
  let prompts = 0
  const sendRequest = async () => { prompts++; return { outcome: { outcome: 'selected', optionId: 'allow_always' } } }
  const sent = []
  let captured
  const runTurn = async function* ({ requestPermission }) {
    captured = await requestPermission({ toolCallId: 't', title: 'Edit', kind: 'edit', rawInput: {} })
    return 'end_turn'
  }
  const server = createAcpServer({ runTurn, sessions: createSessionRegistry(), send: m => sent.push(m), env: {}, sendRequest })
  // Session A grants allow_always.
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'session/new' })
  const a = sent.at(-1).result.sessionId
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: a, prompt: 'x' } })
  // Session B is a fresh session — must prompt again.
  await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'session/new' })
  const b = sent.at(-1).result.sessionId
  await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'session/prompt', params: { sessionId: b, prompt: 'x' } })
  assert.notEqual(a, b)
  assert.equal(prompts, 2, 'each session negotiates its own permissions')
  assert.equal(captured, true)
})

// --- the Write tool (gated, sandboxed) ------------------------------------

test('buildAcpTools: Write is gated — denial blocks file creation, approval creates it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-write-'))
  try {
    let asked = null
    const denyTools = buildAcpTools({ cwd: dir, requestPermission: async tc => { asked = tc; return false } })
    const wDeny = denyTools.find(t => t.name === 'Write')
    assert.ok(wDeny, 'full tool set includes Write')
    await assert.rejects(
      () => wDeny.execute({ file_path: 'new.txt', content: 'hi' }, { toolCall: { id: 'w1' } }),
      /Permission denied/,
    )
    assert.equal(asked?.title, 'Write')
    assert.equal(asked?.kind, 'edit')
    assert.equal(existsSync(join(dir, 'new.txt')), false, 'a denied Write must not create the file')

    const wOk = buildAcpTools({ cwd: dir, requestPermission: async () => true }).find(t => t.name === 'Write')
    await wOk.execute({ file_path: 'new.txt', content: 'hello' }, { toolCall: { id: 'w2' } })
    assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'hello')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildAcpTools: Write cannot escape the workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-write-'))
  try {
    const w = buildAcpTools({ cwd: dir, requestPermission: async () => true }).find(t => t.name === 'Write')
    await assert.rejects(
      () => w.execute({ file_path: '../escape.txt', content: 'x' }, { toolCall: { id: 'w' } }),
      /outside workspace|escapes workspace/,
    )
    assert.equal(existsSync(join(dir, '..', 'escape.txt')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
