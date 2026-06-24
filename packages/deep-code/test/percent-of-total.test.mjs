import { test } from 'node:test'
import assert from 'node:assert/strict'

import { percentOfTotal } from '../src/utils/percentOfTotal.mjs'

test('normal case: part/total*100', () => {
  assert.equal(percentOfTotal(5, 10), 50)
  assert.equal(percentOfTotal(1, 4), 25)
  assert.equal(percentOfTotal(10, 10), 100)
  assert.equal(percentOfTotal(0, 10), 0)
})

test('THE FIX: a zero total yields 0, not NaN/Infinity', () => {
  assert.equal(percentOfTotal(0, 0), 0)
  assert.equal(percentOfTotal(5, 0), 0)
  assert.ok(!Number.isNaN(percentOfTotal(0, 0)))
  assert.ok(Number.isFinite(percentOfTotal(5, 0)))
})

test('a negative total is treated as no-total (guard is total > 0)', () => {
  assert.equal(percentOfTotal(5, -1), 0)
})

test('the result is a number .toFixed(1) can be called on (matches both call sites)', () => {
  assert.equal(percentOfTotal(0, 0).toFixed(1), '0.0')
  assert.equal(percentOfTotal(1, 3).toFixed(1), '33.3')
})
