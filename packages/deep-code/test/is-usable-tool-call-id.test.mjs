import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isUsableToolCallId } from '../src/services/isUsableToolCallId.mjs'
import { mergeDeepSeekToolCallDelta } from '../src/services/providers/deepseek.mjs'
import { mapMessagesToDeepSeek } from '../src/messages/deepseek-normalizer.mjs'
import { validateDeepSeekMessageContract } from '../src/messages/deepseek-contract.mjs'

test('isUsableToolCallId: only a non-empty string is usable', () => {
  assert.equal(isUsableToolCallId('call_1'), true)
  assert.equal(isUsableToolCallId(' '), true) // non-empty (whitespace) is still an id
  assert.equal(isUsableToolCallId(''), false) // THE BUG: empty string is NOT usable
  assert.equal(isUsableToolCallId(undefined), false)
  assert.equal(isUsableToolCallId(null), false)
  assert.equal(isUsableToolCallId(0), false)
  assert.equal(isUsableToolCallId({}), false)
})

const makeId = () => 'STUB'
const tc = () => new Map()

test('THE FIX: an empty-string id delta gets a synthetic id, not ""', () => {
  const m = tc()
  mergeDeepSeekToolCallDelta(
    m,
    { type: 'tool_call_delta', index: 0, id: '', name: 'Read', argumentsDelta: '{"file_path":"/x"}' },
    makeId,
  )
  const [call] = [...m.values()]
  assert.equal(call.id, 'toolu_deepseek_STUB', 'empty id must be synthesized')
  assert.notEqual(call.id, '')
})

test('a conformant non-empty id passes through verbatim (byte-identical path)', () => {
  const m = tc()
  mergeDeepSeekToolCallDelta(
    m,
    { type: 'tool_call_delta', index: 0, id: 'call_real', name: 'Read', argumentsDelta: '{}' },
    makeId,
  )
  assert.equal([...m.values()][0].id, 'call_real')
})

test('empty id first, real id on a later delta → the real id wins', () => {
  const m = tc()
  mergeDeepSeekToolCallDelta(m, { type: 'tool_call_delta', index: 0, id: '', name: 'Read', argumentsDelta: '{"a"' }, makeId)
  mergeDeepSeekToolCallDelta(m, { type: 'tool_call_delta', index: 0, id: 'call_real', argumentsDelta: ':1}' }, makeId)
  const call = [...m.values()][0]
  assert.equal(call.id, 'call_real')
  assert.equal(call.function.arguments, '{"a":1}')
})

test('real id first, empty id on a later delta → the good id is NOT downgraded', () => {
  const m = tc()
  mergeDeepSeekToolCallDelta(m, { type: 'tool_call_delta', index: 0, id: 'call_real', name: 'Read', argumentsDelta: '{"a"' }, makeId)
  mergeDeepSeekToolCallDelta(m, { type: 'tool_call_delta', index: 0, id: '', argumentsDelta: ':1}' }, makeId)
  assert.equal([...m.values()][0].id, 'call_real', 'a trailing empty id must not clobber a good id')
})

test('an omitted (undefined) id still synthesizes — existing behavior preserved', () => {
  const m = tc()
  mergeDeepSeekToolCallDelta(m, { type: 'tool_call_delta', index: 0, name: 'Read', argumentsDelta: '{}' }, makeId)
  assert.equal([...m.values()][0].id, 'toolu_deepseek_STUB')
})

test('END-TO-END: the empty-id wedge is gone — next request is contract-valid', () => {
  // Assemble a turn with an empty-id tool_call (as a non-conformant gateway would),
  // then feed [assistant, tool_result] through the real wire mapper + contract oracle.
  const m = tc()
  mergeDeepSeekToolCallDelta(
    m,
    { type: 'tool_call_delta', index: 0, id: '', name: 'Read', argumentsDelta: '{"file_path":"/x"}' },
    makeId,
  )
  const call = [...m.values()][0]
  const toolUse = { type: 'tool_use', id: call.id, name: call.function.name, input: { file_path: '/x' } }
  const messages = [
    { type: 'assistant', message: { id: 'a1', role: 'assistant', content: [toolUse] } },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'ok' }] },
    },
  ]
  const wire = mapMessagesToDeepSeek(messages)
  const verdict = validateDeepSeekMessageContract(wire)
  assert.equal(verdict.valid, true, `must be valid, got ${JSON.stringify(verdict.violations)}`)
  // The tool_result survives (a "" id would have been dropped by dropOrphanToolMessages).
  assert.equal(wire.filter(m => m.role === 'tool').length, 1)
  assert.equal(wire.find(m => m.role === 'assistant').tool_calls[0].id, call.id)
})
