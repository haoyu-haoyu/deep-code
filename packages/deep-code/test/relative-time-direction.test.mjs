import { test } from 'node:test'
import assert from 'node:assert/strict'

import { subSecondRelativeNarrow } from '../src/utils/relativeTimeDirection.mjs'

// The exact pre-fix decision, kept as a differential oracle: it keyed off
// Math.trunc(diffInMs / 1000) <= 0, which collapses any sub-second delta to 0.
function oldSubSecond(diffInMs) {
  const diffInSeconds = Math.trunc(diffInMs / 1000)
  return diffInSeconds <= 0 ? '0s ago' : 'in 0s'
}

test('THE FIX: a sub-second FUTURE delta is "in 0s", not "0s ago"', () => {
  assert.equal(subSecondRelativeNarrow(500), 'in 0s')
  assert.equal(subSecondRelativeNarrow(999), 'in 0s')
  // The old form mislabeled these as past:
  assert.equal(oldSubSecond(500), '0s ago')
  assert.equal(oldSubSecond(999), '0s ago')
  assert.notEqual(subSecondRelativeNarrow(500), oldSubSecond(500))
})

test('a sub-second PAST delta stays "0s ago" (unchanged)', () => {
  assert.equal(subSecondRelativeNarrow(-1), '0s ago')
  assert.equal(subSecondRelativeNarrow(-500), '0s ago')
  assert.equal(subSecondRelativeNarrow(-999), '0s ago')
  // Past was already correct in the old form too:
  assert.equal(oldSubSecond(-500), '0s ago')
})

test('exact-now (0ms) renders as the future form "in 0s", consistent with the signed >= 1s branches', () => {
  assert.equal(subSecondRelativeNarrow(0), 'in 0s')
})

test('direction is purely the sign of diffInMs', () => {
  for (const ms of [1, 250, 999, 1, 0]) {
    assert.equal(subSecondRelativeNarrow(ms), 'in 0s')
  }
  for (const ms of [-1, -250, -999]) {
    assert.equal(subSecondRelativeNarrow(ms), '0s ago')
  }
})
