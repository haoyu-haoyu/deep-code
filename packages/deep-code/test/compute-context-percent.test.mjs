import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeContextPercent } from '../src/utils/computeContextPercent.mjs'

const WINDOW = 200_000

test('in-range usage rounds like before', () => {
  assert.equal(computeContextPercent(100_000, WINDOW), 50)
  assert.equal(computeContextPercent(0, WINDOW), 0)
  assert.equal(computeContextPercent(1_500, WINDOW), 1) // 0.75% -> rounds to 1
  assert.equal(computeContextPercent(199_000, WINDOW), 100) // 99.5% -> rounds to 100
})

test('THE FIX: overage is clamped to 100 (was an unclamped >100 on /context)', () => {
  // input 0 + cache_creation 20k + cache_read 190k = 210k > 200k window
  assert.equal(computeContextPercent(210_000, WINDOW), 100)
  // The pre-fix /context expression would have shown 105:
  assert.equal(Math.round((210_000 / WINDOW) * 100), 105)
  assert.notEqual(
    computeContextPercent(210_000, WINDOW),
    Math.round((210_000 / WINDOW) * 100),
  )
})

test('exactly full is 100', () => {
  assert.equal(computeContextPercent(200_000, WINDOW), 100)
})

test('negative total clamps to 0', () => {
  assert.equal(computeContextPercent(-5_000, WINDOW), 0)
})

test('parity: matches the StatusLine clamp formula across a sweep', () => {
  // calculateContextPercentages computes exactly this for `used`.
  const statusLineUsed = total =>
    Math.min(100, Math.max(0, Math.round((total / WINDOW) * 100)))
  for (const total of [0, 1, 1_500, 100_000, 199_000, 200_000, 210_000, 400_000]) {
    assert.equal(computeContextPercent(total, WINDOW), statusLineUsed(total), `total=${total}`)
  }
})
