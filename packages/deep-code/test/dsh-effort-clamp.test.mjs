import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clampUnsupportedEffort } from '../src/utils/effortClamp.mjs'

const deepseek = { supportsMax: true, supportsXhigh: true } // DeepSeek-v4
const opus46 = { supportsMax: true, supportsXhigh: false } // Opus-4.6 (max, no xhigh)
const plain = { supportsMax: false, supportsXhigh: false } // most other models

test('DeepSeek keeps every tier including xhigh and max', () => {
  for (const e of ['low', 'medium', 'high', 'max', 'xhigh']) {
    assert.equal(clampUnsupportedEffort(e, deepseek), e)
  }
})

test('xhigh clamps to max on a max-capable non-DeepSeek model (Opus-4.6)', () => {
  assert.equal(clampUnsupportedEffort('xhigh', opus46), 'max')
  assert.equal(clampUnsupportedEffort('max', opus46), 'max')
  assert.equal(clampUnsupportedEffort('high', opus46), 'high')
})

test('xhigh degrades two steps (xhigh→max→high) on a model without max', () => {
  assert.equal(clampUnsupportedEffort('xhigh', plain), 'high')
  // and the pre-existing max→high clamp is preserved exactly
  assert.equal(clampUnsupportedEffort('max', plain), 'high')
})

test('low/medium/high are never clamped', () => {
  for (const caps of [deepseek, opus46, plain]) {
    assert.equal(clampUnsupportedEffort('low', caps), 'low')
    assert.equal(clampUnsupportedEffort('medium', caps), 'medium')
    assert.equal(clampUnsupportedEffort('high', caps), 'high')
  }
})

test('numeric (ANT) and undefined efforts pass through untouched (byte-identical to old behavior)', () => {
  for (const caps of [deepseek, opus46, plain]) {
    assert.equal(clampUnsupportedEffort(undefined, caps), undefined)
    assert.equal(clampUnsupportedEffort(42, caps), 42)
    assert.equal(clampUnsupportedEffort(0, caps), 0)
  }
})

test('preserves the exact old single-step contract for max (the only prior clamp)', () => {
  // old: `resolved === 'max' && !supportsMax ? 'high' : resolved`
  const oldMaxClamp = (e, supportsMax) =>
    e === 'max' && !supportsMax ? 'high' : e
  for (const e of ['low', 'medium', 'high', 'max', 99, undefined]) {
    for (const supportsMax of [true, false]) {
      // xhigh capability irrelevant when input isn't xhigh; old code had no xhigh
      assert.equal(
        clampUnsupportedEffort(e, { supportsMax, supportsXhigh: true }),
        oldMaxClamp(e, supportsMax),
        `max-path parity for ${e}/${supportsMax}`,
      )
    }
  }
})
