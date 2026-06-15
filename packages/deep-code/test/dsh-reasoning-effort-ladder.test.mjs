import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coerceDeepSeekEffort,
  DEEPSEEK_REASONING_EFFORTS,
  resolveEffortPickerIndex,
} from '../src/services/providers/deepseekEffort.mjs'

// Reconstructions of the TWO old collapse functions (deepseek.mjs normalizeDeepSeekEffort
// and deepseek-call-model.mjs resolveDeepSeekReasoningEffort) for a differential.
function oldNormalize(value) {
  const n = String(value ?? 'max').toLowerCase()
  if (n === 'max' || n === 'xhigh') return 'max'
  return 'high'
}
function oldResolve(effortValue) {
  if (effortValue === undefined || effortValue === null) return undefined
  const n =
    typeof effortValue === 'string'
      ? effortValue.toLowerCase()
      : String(effortValue).toLowerCase()
  if (n === 'max' || n === 'xhigh') return 'max'
  return 'high'
}

const newNormalize = v => coerceDeepSeekEffort(v, { unset: 'max', fallback: 'high' })
const newResolve = v => coerceDeepSeekEffort(v, { unset: undefined, fallback: 'high' })

test('the server enum is the 5 probe-confirmed tiers', () => {
  assert.deepEqual([...DEEPSEEK_REASONING_EFFORTS], ['low', 'medium', 'high', 'max', 'xhigh'])
})

test('resolveEffortPickerIndex: current tier maps to its index across the full ladder', () => {
  const efforts = DEEPSEEK_REASONING_EFFORTS
  assert.equal(resolveEffortPickerIndex(efforts, 'low'), 0)
  assert.equal(resolveEffortPickerIndex(efforts, 'medium'), 1)
  assert.equal(resolveEffortPickerIndex(efforts, 'high'), 2)
  assert.equal(resolveEffortPickerIndex(efforts, 'max'), 3)
  assert.equal(resolveEffortPickerIndex(efforts, 'xhigh'), 4)
  assert.equal(resolveEffortPickerIndex(efforts, 'MAX'), 3, 'case-insensitive')
})

test('resolveEffortPickerIndex: unknown/unset falls back to the max index, never the deepest tier', () => {
  const efforts = DEEPSEEK_REASONING_EFFORTS
  for (const v of [undefined, null, '', 'bogus', 'auto']) {
    assert.equal(resolveEffortPickerIndex(efforts, v), 3, `fallback for ${JSON.stringify(v)} = max index`)
  }
  // fallback absent from the option list → 0 (never out of range)
  assert.equal(resolveEffortPickerIndex(['low', 'high'], 'bogus'), 0)
  assert.equal(resolveEffortPickerIndex(['low', 'high'], 'high'), 1)
})

test('the graded ladder now passes through faithfully (the fix)', () => {
  for (const e of ['low', 'medium', 'high', 'max', 'xhigh']) {
    assert.equal(newNormalize(e), e, `normalize ${e}`)
    assert.equal(newResolve(e), e, `resolve ${e}`)
  }
  // case-insensitive
  assert.equal(newNormalize('XHIGH'), 'xhigh')
  assert.equal(newResolve('Low'), 'low')
})

test('xhigh is no longer downgraded to max, low/medium no longer upgraded to high', () => {
  // the three behavior changes vs the old collapse
  assert.equal(oldNormalize('xhigh'), 'max')
  assert.equal(newNormalize('xhigh'), 'xhigh')
  assert.equal(oldNormalize('low'), 'high')
  assert.equal(newNormalize('low'), 'low')
  assert.equal(oldNormalize('medium'), 'high')
  assert.equal(newNormalize('medium'), 'medium')
})

test('default (unset) is byte-identical: normalize→max, resolve→undefined', () => {
  for (const v of [undefined, null]) {
    assert.equal(newNormalize(v), 'max', `normalize ${v} preserves the max default`)
    assert.equal(newResolve(v), undefined, `resolve ${v} preserves undefined`)
    assert.equal(newNormalize(v), oldNormalize(v))
    assert.equal(newResolve(v), oldResolve(v))
  }
})

test('unrecognized values still fall back to high (unchanged safety)', () => {
  for (const v of ['minimal', 'garbage', 'maxx', 'hi', '', '  ', '0', 'true']) {
    assert.equal(newNormalize(v), oldNormalize(v), `normalize ${JSON.stringify(v)}`)
    assert.equal(newResolve(v), oldResolve(v), `resolve ${JSON.stringify(v)}`)
    assert.equal(newNormalize(v), 'high')
  }
  // numbers/booleans coerce then fall back, like the old String()-based path
  for (const v of [0, 1, 42, true, false]) {
    assert.equal(newNormalize(v), oldNormalize(v), `normalize ${v}`)
    assert.equal(newResolve(v), oldResolve(v), `resolve ${v}`)
  }
})

test('DIFFERENTIAL: new === old for EVERY input except {low,medium,xhigh} (the intended passthroughs)', () => {
  const intended = new Set(['low', 'medium', 'xhigh'])
  const inputs = [
    undefined, null, '', '   ', '0', 'true', 'false', 'minimal', 'garbage', 'maxx',
    'low', 'LOW', 'medium', 'Medium', 'high', 'HIGH', 'max', 'MAX', 'xhigh', 'XHIGH',
    0, 1, 42, -1, true, false, 'reasoning', 'none', 'off',
  ]
  for (const v of inputs) {
    const norm = String(v ?? '').toLowerCase()
    if (intended.has(norm)) {
      // these are the only divergences and they are the fix
      assert.notEqual(newNormalize(v), oldNormalize(v), `expected divergence at ${JSON.stringify(v)}`)
    } else {
      assert.equal(newNormalize(v), oldNormalize(v), `normalize divergence at ${JSON.stringify(v)}`)
      assert.equal(newResolve(v), oldResolve(v), `resolve divergence at ${JSON.stringify(v)}`)
    }
  }
})
