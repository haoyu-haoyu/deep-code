import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appendHarnessRuntimeTail } from '../src/deepcode/harnessRuntimeTail.mjs'

const reminder = text => ({ role: 'reminder', content: text })

test('appends the harness context as a NEW final message; earlier messages untouched', () => {
  const msgs = [{ id: 0 }, { id: 1 }]
  const out = appendHarnessRuntimeTail(msgs, 'Runtime signals: tests', reminder)
  assert.equal(out.length, 3)
  assert.equal(out[0], msgs[0]) // reference-identical prefix — never mutated
  assert.equal(out[1], msgs[1])
  assert.deepEqual(out[2], { role: 'reminder', content: 'Runtime signals: tests' })
})

test('default-inert: no active harness context returns the SAME array (byte-identical baseline)', () => {
  const msgs = [{ id: 0 }]
  assert.equal(appendHarnessRuntimeTail(msgs, undefined, reminder), msgs)
  assert.equal(appendHarnessRuntimeTail(msgs, null, reminder), msgs)
  assert.equal(appendHarnessRuntimeTail(msgs, '', reminder), msgs)
})

test('CACHE-MOAT: a varying harness context only changes the TAIL — the prefix stays byte-stable', () => {
  // The whole point of the fix: turn-to-turn the harness classification varies, but that
  // volatility must NOT reach the cached prefix. Appending at the tail keeps every prior
  // message reference-identical across turns (DeepSeek prefix cache stays matched).
  const history = [{ id: 'sys' }, { id: 'h1' }, { id: 'user' }]
  const turnA = appendHarnessRuntimeTail(history, 'signals: A', reminder)
  const turnB = appendHarnessRuntimeTail(history, 'signals: B, different', reminder)
  assert.equal(turnA.length, turnB.length)
  for (let i = 0; i < history.length; i++) {
    assert.equal(turnA[i], turnB[i], `prefix element ${i} must be identical across turns`)
    assert.equal(turnA[i], history[i], `prefix element ${i} must be the original (unmutated)`)
  }
  assert.notDeepEqual(turnA.at(-1), turnB.at(-1)) // only the trailing reminder differs
})

test('fail-safe: a throwing factory leaves messages unchanged (never breaks the turn)', () => {
  const msgs = [{ id: 0 }]
  const out = appendHarnessRuntimeTail(msgs, 'x', () => {
    throw new Error('boom')
  })
  assert.equal(out, msgs)
})

test('a factory returning null appends nothing', () => {
  const msgs = [{ id: 0 }]
  assert.equal(appendHarnessRuntimeTail(msgs, 'x', () => null), msgs)
})

test('non-array messages returned unchanged', () => {
  assert.equal(appendHarnessRuntimeTail(null, 'x', reminder), null)
  assert.equal(appendHarnessRuntimeTail(undefined, 'x', reminder), undefined)
})
