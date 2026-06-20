import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acpAgentTurn,
  buildReadOnlyAcpTools,
  mapProviderEventToAcp,
  pumpUpdates,
} from '../src/cli/serve/acp/agentTurn.mjs'
import {
  createDeepSeekLocalTools,
  resolveWorkspacePath,
} from '../src/deepcode/local-toolchain.mjs'
import { mapStopReason } from '../src/cli/serve/acp/protocol.mjs'
import { providerSupports } from '../src/deepcode/provider-capabilities.mjs'
import { createDeepSeekProvider } from '../src/services/providers/deepseek.mjs'
import { createOpenAICompatibleProvider } from '../src/services/providers/openai-compatible.mjs'

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

test('mapProviderEventToAcp gates reasoning by provider capability (no CoT leak for non-reasoning providers)', () => {
  // Mirror the main query loop (deepseek-call-model.mjs): reasoning_delta becomes
  // an ACP thought ONLY when the provider supports reasoning_content. An
  // openai-compatible provider declares it false but reuses the DeepSeek SSE
  // parser, so a reasoning model proxied through it would otherwise leak CoT.
  const reasoning = { type: 'reasoning_delta', text: 'secret chain of thought' }
  const deepseek = createDeepSeekProvider()
  const openaiCompat = createOpenAICompatibleProvider({ providerName: 'ollama', baseUrl: 'http://x', apiKey: 'k' })

  // capability-supporting provider → mapped; capability-lacking provider → null
  assert.equal(providerSupports(deepseek, 'reasoning_content'), true)
  assert.equal(providerSupports(openaiCompat, 'reasoning_content'), false)
  assert.deepEqual(mapProviderEventToAcp(reasoning, deepseek), {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'secret chain of thought' },
  })
  assert.equal(mapProviderEventToAcp(reasoning, openaiCompat), null) // gated → no leak
  // content is never gated (only reasoning is); no-provider keeps back-compat
  assert.deepEqual(mapProviderEventToAcp({ type: 'content_delta', text: 'hi' }, openaiCompat), {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hi' },
  })
  assert.ok(mapProviderEventToAcp(reasoning) !== null) // no provider → unchanged
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

test('acpAgentTurn: a DENIED write feeds the failure back through the REAL agent loop and the turn finishes (not -32603)', async () => {
  // Integration over the real runDeepSeekAgent (default runAgent): the model
  // emits an Edit, the editor denies it, and the turn must FINISH — the denial
  // is fed back as a tool result so the model can respond — instead of crashing
  // the whole turn. Drives the loop via a fake provider's streamQuery.
  const dir = mkdtempSync(join(tmpdir(), 'acp-deny-'))
  try {
    let streamCalls = 0
    const provider = {
      ...createDeepSeekProvider(),
      streamQuery() {
        streamCalls++
        if (streamCalls === 1) {
          return (async function* () {
            yield {
              type: 'tool_call_delta',
              index: 0,
              id: 'call_edit',
              name: 'Edit',
              argumentsDelta: '{"file_path":"a.txt","old_string":"x","new_string":"y"}',
              finishReason: 'tool_calls',
            }
          })()
        }
        return (async function* () {
          yield { type: 'content_delta', text: 'The edit was denied, so I stopped.' }
          yield { type: 'finish', finishReason: 'stop' }
        })()
      },
    }
    const updates = []
    const gen = acpAgentTurn({
      prompt: 'fix the typo',
      cwd: dir,
      env: { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_CACHE_USER_ID: 'workspace-1' },
      provider,
      requestPermission: async () => false, // editor denies the write
    })
    let step = await gen.next()
    while (!step.done) {
      updates.push(step.value)
      step = await gen.next()
    }
    // The turn FINISHED cleanly: the generator RETURNED the model's natural
    // finish reason rather than REJECTING. Pre-fix the denial throw unwound out
    // of runDeepSeekAgent and the turn aborted (→ JSON-RPC -32603); now the
    // model's second turn runs to a normal 'stop'.
    assert.equal(step.value, 'stop')
    // The editor saw the denial as a failed tool_call_update.
    assert.ok(
      updates.some(u => u.sessionUpdate === 'tool_call_update' && u.status === 'failed'),
      'a failed tool_call_update was emitted for the denied Edit',
    )
    // The model was re-invoked after the denial (the failure was fed back).
    assert.equal(streamCalls, 2)
    // And its follow-up message reached the editor.
    assert.ok(
      updates.some(u => u.sessionUpdate === 'agent_message_chunk' && /denied/.test(u.content?.text ?? '')),
    )
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

// --- dangling-symlink Write escape -----------------------------------------
// A DANGLING symlink (link present, target absent) made realpathSync throw
// ENOENT just like a brand-new file, so the sandbox guard returned the lexical
// path unvalidated and a Write followed the dead link OUTSIDE the workspace.
// Read can't trigger it (it readFile()s first → ENOENT), so the guard itself is
// the seam.

test('resolveWorkspacePath rejects a dangling symlink pointing OUTSIDE the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  const outside = mkdtempSync(join(tmpdir(), 'acp-out-'))
  // link.txt → outside/evil.txt, which does NOT exist yet (dangling).
  symlinkSync(join(outside, 'evil.txt'), join(root, 'link.txt'))
  try {
    assert.throws(
      () => resolveWorkspacePath(root, 'link.txt'),
      /escapes workspace via symlink/,
      'a dangling link to outside must be rejected, not treated as a new file',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('resolveWorkspacePath ALLOWS a dangling symlink pointing INSIDE the workspace (no over-reject)', () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  // link.txt → ./sub/new.txt (new.txt absent) — a legit in-workspace dangling
  // link; writing through it must still be permitted.
  symlinkSync(join(root, 'sub', 'new.txt'), join(root, 'link.txt'))
  try {
    assert.equal(resolveWorkspacePath(root, 'link.txt'), join(root, 'link.txt'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveWorkspacePath refuses a symlink cycle rather than looping forever', () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  symlinkSync(join(root, 'b'), join(root, 'a')) // a → b
  symlinkSync(join(root, 'a'), join(root, 'b')) // b → a (cycle)
  try {
    assert.throws(() => resolveWorkspacePath(root, 'a'), /escapes workspace via symlink/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a genuinely new (non-symlink) file still resolves inside the workspace (regression)', () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  try {
    assert.equal(resolveWorkspacePath(root, 'brand-new.txt'), join(root, 'brand-new.txt'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Write through a dangling outside symlink is rejected and creates NOTHING outside', async () => {
  const root = mkdtempSync(join(tmpdir(), 'acp-ws-'))
  const outside = mkdtempSync(join(tmpdir(), 'acp-out-'))
  const outsideTarget = join(outside, 'evil.txt')
  symlinkSync(outsideTarget, join(root, 'link.txt'))
  try {
    const write = createDeepSeekLocalTools({ cwd: root }).find(t => t.name === 'Write')
    await assert.rejects(
      () => write.execute({ file_path: 'link.txt', content: 'PWNED' }, { toolCall: { id: 'c' } }),
      /escapes workspace via symlink/,
    )
    assert.equal(existsSync(outsideTarget), false, 'no content written outside the workspace')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
