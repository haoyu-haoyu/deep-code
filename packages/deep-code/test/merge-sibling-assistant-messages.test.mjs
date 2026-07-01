import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSiblingAssistantMessages } from '../src/messages/mergeSiblingAssistantMessages.mjs'
import { mapMessagesToDeepSeek } from '../src/messages/deepseek-normalizer.mjs'
import { validateDeepSeekMessageContract } from '../src/messages/deepseek-contract.mjs'

const asst = (msgId, ...blocks) => ({
  type: 'assistant',
  uuid: `u_${msgId}_${blocks.map(b => b.id ?? b.type).join('_')}`,
  message: { id: msgId, role: 'assistant', content: blocks },
})
const toolUse = id => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } })
const text = t => ({ type: 'text', text: t })
const thinking = t => ({ type: 'thinking', thinking: t })
const userTR = id => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
})
const userText = t => ({ type: 'user', message: { role: 'user', content: [text(t)] } })

// The wedge: a parallel-tool turn persisted as two same-message.id sibling assistants
// (one tool_use each), then both tool_results. This is what recoverOrphanedParallelToolResults
// reconstructs on resume of a legacy/split transcript.
const wedge = [
  userText('do two things'),
  asst('msg_parallel', toolUse('call_X')),
  asst('msg_parallel', toolUse('call_Y')),
  userTR('call_X'),
  userTR('call_Y'),
]

test('THE BUG: without merge the wedge maps to an invalid DeepSeek request (dangling+orphan 400)', () => {
  // Map the RAW sibling shape (bypassing the merge) to confirm the failure it prevents.
  const mapped = []
  for (const m of wedge) {
    if (m.type === 'assistant') {
      mapped.push({
        role: 'assistant',
        content: '',
        tool_calls: m.message.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: '{}' } })),
      })
    } else {
      for (const b of m.message.content) {
        if (b.type === 'tool_result') mapped.push({ role: 'tool', tool_call_id: b.tool_use_id, content: 'ok' })
        else mapped.push({ role: 'user', content: b.text })
      }
    }
  }
  const raw = validateDeepSeekMessageContract(mapped)
  assert.equal(raw.valid, false, 'raw sibling shape must be contract-invalid (the wedge)')
})

test('THE FIX: mergeSiblingAssistantMessages makes the wedge map to a VALID DeepSeek request', () => {
  const merged = mapMessagesToDeepSeek(wedge)
  const verdict = validateDeepSeekMessageContract(merged)
  assert.equal(verdict.valid, true, `wedge must become valid, got ${JSON.stringify(verdict.violations)}`)
  // Exactly one assistant carrying BOTH tool_calls, then the two tool answers.
  const assistants = merged.filter(m => m.role === 'assistant')
  assert.equal(assistants.length, 1)
  assert.deepEqual(assistants[0].tool_calls.map(c => c.id), ['call_X', 'call_Y'])
  assert.equal(merged.filter(m => m.role === 'tool').length, 2)
})

test('leaf: merges consecutive same-id assistants, concatenating content in order', () => {
  const out = mergeSiblingAssistantMessages([
    asst('m1', toolUse('X')),
    asst('m1', toolUse('Y')),
  ])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].message.content.map(b => b.id), ['X', 'Y'])
  assert.equal(out[0].message.id, 'm1')
})

test('leaf: 3+ siblings chain into a single message', () => {
  const out = mergeSiblingAssistantMessages([
    asst('m1', toolUse('X')),
    asst('m1', toolUse('Y')),
    asst('m1', toolUse('Z')),
  ])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].message.content.map(b => b.id), ['X', 'Y', 'Z'])
})

test('leaf: merges a text fragment with a same-id tool_use fragment (content-block split)', () => {
  const out = mergeSiblingAssistantMessages([
    asst('m1', thinking('reason'), text('hi')),
    asst('m1', toolUse('X')),
  ])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].message.content.map(b => b.type), ['thinking', 'text', 'tool_use'])
})

test('leaf: NO-OP for a normal session (one assistant per turn) — output is reference-identical', () => {
  const normal = [
    userText('hi'),
    asst('m1', toolUse('X')),
    userTR('X'),
    asst('m2', text('done')),
  ]
  const out = mergeSiblingAssistantMessages(normal)
  assert.equal(out.length, normal.length)
  out.forEach((m, i) => assert.equal(m, normal[i], `element ${i} must be the same reference (no rebuild)`))
})

test('leaf: adjacent assistants with DIFFERENT ids are NOT merged', () => {
  const out = mergeSiblingAssistantMessages([
    asst('m1', toolUse('X')),
    asst('m2', toolUse('Y')),
  ])
  assert.equal(out.length, 2)
})

test('leaf: assistants with undefined message.id are NOT merged (no accidental collapse)', () => {
  const noId = t => ({ type: 'assistant', message: { role: 'assistant', content: [text(t)] } })
  const out = mergeSiblingAssistantMessages([noId('a'), noId('b')])
  assert.equal(out.length, 2)
})

test('leaf: a tool_result BETWEEN two same-id assistants blocks the merge (already-valid interleave)', () => {
  // asstA | tool[X] | asstB | tool[Y] is already a valid DeepSeek shape (each tool
  // answers its immediately-preceding assistant). The siblings are not adjacent, so
  // the merge must leave them apart.
  const interleaved = [
    asst('m1', toolUse('X')),
    userTR('X'),
    asst('m1', toolUse('Y')),
    userTR('Y'),
  ]
  const out = mergeSiblingAssistantMessages(interleaved)
  assert.equal(out.length, 4)
  const verdict = validateDeepSeekMessageContract(mapMessagesToDeepSeek(interleaved))
  assert.equal(verdict.valid, true)
})

test('leaf: same-id siblings with STRING content are NOT merged (no char-shatter)', () => {
  // Off-schema today (createAssistantMessage normalizes to arrays) but the merge must
  // not spread a string into chars — leave it for the mapper's own String() guard.
  const strAsst = t => ({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: t } })
  const out = mergeSiblingAssistantMessages([strAsst('hello'), strAsst('world')])
  assert.equal(out.length, 2)
  assert.equal(out[0].message.content, 'hello')
  assert.equal(out[1].message.content, 'world')
})

test('leaf: non-array input is returned unchanged', () => {
  assert.equal(mergeSiblingAssistantMessages(null), null)
  assert.equal(mergeSiblingAssistantMessages(undefined), undefined)
})
