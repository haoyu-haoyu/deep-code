import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acpAgentTurn,
  buildReadOnlyAcpTools,
  mapProviderEventToAcp,
  pumpUpdates,
} from '../src/cli/serve/acp/agentTurn.mjs'
import { mapStopReason } from '../src/cli/serve/acp/protocol.mjs'

// --- pumpUpdates (callback -> async generator bridge) ---------------------

test('pumpUpdates yields pushed values in order and returns the drive result', async () => {
  const gen = pumpUpdates(async push => {
    push('a')
    push('b')
    await new Promise(r => setTimeout(r, 5))
    push('c')
    return 'done'
  })
  const out = []
  let step = await gen.next()
  while (!step.done) {
    out.push(step.value)
    step = await gen.next()
  }
  assert.deepEqual(out, ['a', 'b', 'c'])
  assert.equal(step.value, 'done')
})

test('pumpUpdates rethrows the drive error after draining', async () => {
  const gen = pumpUpdates(async push => {
    push('x')
    throw new Error('boom')
  })
  const out = []
  await assert.rejects(async () => {
    let step = await gen.next()
    while (!step.done) {
      out.push(step.value)
      step = await gen.next()
    }
  }, /boom/)
  assert.deepEqual(out, ['x'])
})

// --- provider-event mapping + stop reason ---------------------------------

test('mapProviderEventToAcp maps reasoning/content deltas, ignores the rest', () => {
  assert.deepEqual(mapProviderEventToAcp({ type: 'reasoning_delta', text: 'hmm' }), {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'hmm' },
  })
  assert.deepEqual(mapProviderEventToAcp({ type: 'content_delta', text: 'hi' }), {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hi' },
  })
  assert.equal(mapProviderEventToAcp({ type: 'tool_call_delta', id: 't', name: 'x' }), null)
  assert.equal(mapProviderEventToAcp({ type: 'usage', usage: {} }), null)
})

test('mapStopReason maps max_turns to max_turn_requests', () => {
  assert.equal(mapStopReason('max_turns'), 'max_turn_requests')
  assert.equal(mapStopReason('max_turn_requests'), 'max_turn_requests')
  assert.equal(mapStopReason('stop'), 'end_turn')
})

// --- read-only tool set ---------------------------------------------------

test('buildReadOnlyAcpTools drops Edit and keeps the read-only tools', () => {
  const names = buildReadOnlyAcpTools({ cwd: process.cwd() }).map(t => t.name).sort()
  assert.deepEqual(names, ['Bash', 'Read'])
  assert.equal(names.includes('Edit'), false)
})

test('Read tool reads inside cwd and emits tool_call_update lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-agent-'))
  writeFileSync(join(dir, 'note.txt'), 'hello acp')
  try {
    const updates = []
    const tools = buildReadOnlyAcpTools({ cwd: dir, onUpdate: u => updates.push(u) })
    const read = tools.find(t => t.name === 'Read')
    const out = await read.execute({ file_path: 'note.txt' }, { toolCall: { id: 'c1' } })
    assert.equal(out, 'hello acp')
    assert.deepEqual(
      updates.map(u => u.status),
      ['in_progress', 'completed'],
    )
    assert.equal(updates[1].toolCallId, 'c1')
    assert.match(updates[1].content[0].content.text, /hello acp/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Read tool rejects path traversal and emits a failed tool_call_update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-agent-'))
  try {
    const updates = []
    const tools = buildReadOnlyAcpTools({ cwd: dir, onUpdate: u => updates.push(u) })
    const read = tools.find(t => t.name === 'Read')
    await assert.rejects(() => read.execute({ file_path: '../../etc/passwd' }, { toolCall: { id: 'c2' } }), /outside workspace/)
    assert.deepEqual(updates.map(u => u.status), ['in_progress', 'failed'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- acpAgentTurn wiring (mock agent, no network) -------------------------

test('acpAgentTurn streams tool updates and returns the finish reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-agent-'))
  writeFileSync(join(dir, 'a.txt'), 'file body')
  try {
    // Mock runAgent: announce a tool_call, run a wrapped Read (-> tool_call_update),
    // emit a final message chunk, finish naturally.
    const runAgent = async ({ tools, complete: _complete, prompt }) => {
      assert.equal(prompt, 'read a.txt')
      const read = tools.find(t => t.name === 'Read')
      await read.execute({ file_path: 'a.txt' }, { toolCall: { id: 'call-1' } })
      return { content: 'a.txt contains "file body"' } // no stoppedReason -> end_turn
    }
    const gen = acpAgentTurn({ prompt: 'read a.txt', cwd: dir, runAgent })
    const updates = []
    let step = await gen.next()
    while (!step.done) {
      updates.push(step.value)
      step = await gen.next()
    }
    assert.equal(step.value, 'end_turn')
    assert.ok(updates.some(u => u.sessionUpdate === 'tool_call_update' && u.status === 'in_progress'))
    const completed = updates.find(u => u.sessionUpdate === 'tool_call_update' && u.status === 'completed')
    assert.ok(completed && /file body/.test(completed.content[0].content.text))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('acpAgentTurn maps a max_turns cap to the runtime finish reason', async () => {
  const runAgent = async () => ({ content: '', stoppedReason: 'max_turns' })
  const gen = acpAgentTurn({ prompt: 'x', cwd: process.cwd(), runAgent })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  assert.equal(step.value, 'max_turns')
})

test('acpAgentTurn threads the configured provider into runAgent AND the streaming complete', async () => {
  // A fake non-DeepSeek provider: streamQuery yields the shared event vocabulary.
  let streamQueryCalls = 0
  const provider = {
    name: 'openai-compatible',
    streamQuery() {
      streamQueryCalls++
      return (async function* () {
        yield { type: 'content_delta', text: 'Hi from provider' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    },
  }
  // runAgent receives the resolved provider; it drives the real makeStreamingComplete.
  let receivedProvider
  const runAgent = async ({ provider: p, complete }) => {
    receivedProvider = p
    const res = await complete({ url: 'u', method: 'POST', headers: {}, body: '{}' })
    return { content: res.content, stoppedReason: undefined }
  }
  const updates = []
  const gen = acpAgentTurn({ prompt: 'hi', cwd: process.cwd(), provider, runAgent })
  let step = await gen.next()
  while (!step.done) {
    updates.push(step.value)
    step = await gen.next()
  }
  // the explicit provider was threaded into runAgent
  assert.equal(receivedProvider, provider)
  // and the streaming `complete` streamed via that SAME provider (not streamDeepSeekQuery)
  assert.equal(streamQueryCalls, 1)
  // its content_delta was mapped + pushed as an ACP agent_message_chunk
  assert.ok(
    updates.some(
      u => u.sessionUpdate === 'agent_message_chunk' && u.content?.text === 'Hi from provider',
    ),
  )
})

// --- review fixes: sandbox + cancellation + bridge robustness -------------

test('Read rejects a symlink that escapes the workspace (canonicalized sandbox)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  const outside = mkdtempSync(join(tmpdir(), 'acp-out-'))
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
  try {
    const read = buildReadOnlyAcpTools({ cwd: root }).find(t => t.name === 'Read')
    await assert.rejects(
      () => read.execute({ file_path: 'link.txt' }, { toolCall: { id: 'c' } }),
      /symlink|outside/i,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('an aborted signal prevents a read-only tool from starting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  writeFileSync(join(dir, 'f.txt'), 'data')
  try {
    const ac = new AbortController()
    ac.abort()
    const read = buildReadOnlyAcpTools({ cwd: dir, signal: ac.signal }).find(t => t.name === 'Read')
    await assert.rejects(() => read.execute({ file_path: 'f.txt' }, { toolCall: { id: 'c' } }), /abort/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pumpUpdates drains queued items even when drive throws synchronously', async () => {
  const gen = pumpUpdates(push => {
    push('q1')
    throw new Error('sync-boom')
  })
  const out = []
  await assert.rejects(async () => {
    let step = await gen.next()
    while (!step.done) {
      out.push(step.value)
      step = await gen.next()
    }
  }, /sync-boom/)
  assert.deepEqual(out, ['q1'])
})

test('Read rejects a symlinked PARENT directory escape (even for a not-yet-existing leaf)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  const outside = mkdtempSync(join(tmpdir(), 'acp-out-'))
  // linkdir inside the workspace points at an outside directory.
  symlinkSync(outside, join(root, 'linkdir'))
  try {
    const read = buildReadOnlyAcpTools({ cwd: root }).find(t => t.name === 'Read')
    // Leaf does not exist — must still be rejected via the parent symlink, not
    // allowed through to a follow-the-symlink read.
    await assert.rejects(
      () => read.execute({ file_path: 'linkdir/whatever.txt' }, { toolCall: { id: 'c' } }),
      /escapes workspace via symlink/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
