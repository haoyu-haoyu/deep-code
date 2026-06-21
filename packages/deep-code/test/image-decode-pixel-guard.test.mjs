import { test } from 'node:test'
import assert from 'node:assert/strict'

import { exceedsDecodePixelBudget } from '../src/utils/imageDecodePixelGuard.mjs'

const CAP = 100_000_000 // 100 megapixels

test('a normal image is within budget', () => {
  assert.equal(exceedsDecodePixelBudget(3840, 2160, CAP), false) // 4K, ~8.3 Mpx
  assert.equal(exceedsDecodePixelBudget(6000, 4000, CAP), false) // 24 MP photo
  assert.equal(exceedsDecodePixelBudget(2000, 2000, CAP), false)
})

test('THE FIX: a pixel-flood bomb exceeds the budget', () => {
  assert.equal(exceedsDecodePixelBudget(16384, 16384, CAP), true) // ~268 Mpx
  assert.equal(exceedsDecodePixelBudget(30000, 30000, CAP), true) // ~900 Mpx
  assert.equal(exceedsDecodePixelBudget(200000, 1000, CAP), true) // skewed bomb (200 Mpx)
})

test('the boundary is exclusive (exactly at cap is allowed)', () => {
  assert.equal(exceedsDecodePixelBudget(10000, 10000, CAP), false) // exactly 100 Mpx
  assert.equal(exceedsDecodePixelBudget(10000, 10001, CAP), true) // 1 row over
})

test('absurd dimensions past Number precision still exceed (comparison stays correct)', () => {
  // 2^31 squared loses precision but is vastly > CAP
  assert.equal(exceedsDecodePixelBudget(2 ** 31, 2 ** 31, CAP), true)
})

test('non-finite / non-positive dimensions are NOT flagged (missing-dims path handles them)', () => {
  assert.equal(exceedsDecodePixelBudget(NaN, 100, CAP), false)
  assert.equal(exceedsDecodePixelBudget(100, Infinity, CAP), false)
  assert.equal(exceedsDecodePixelBudget(0, 100, CAP), false)
  assert.equal(exceedsDecodePixelBudget(-5, 100, CAP), false)
  assert.equal(exceedsDecodePixelBudget(undefined, 100, CAP), false)
})
