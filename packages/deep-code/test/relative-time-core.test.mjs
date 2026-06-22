import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatRelativeTimeCore } from '../src/utils/relativeTimeCore.mjs'

// The real injected formatter (intl.ts's getRelativeTimeFormat, minus caching).
const getFormat = (style, numeric) =>
  new Intl.RelativeTimeFormat('en', { style, numeric })

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('THE FIX: a requested short style is honored for sub-day units', () => {
  // 5 minutes ago, short -> "5 min. ago" (was "5 minutes ago" when style was hardcoded long)
  assert.equal(formatRelativeTimeCore(-5 * MIN, 'short', 'always', getFormat), '5 min. ago')
  assert.equal(formatRelativeTimeCore(-3 * HOUR, 'short', 'always', getFormat), '3 hr. ago')
  // The old hardcoded-long behavior, for contrast:
  assert.equal(getFormat('long', 'always').format(-5, 'minute'), '5 minutes ago')
  assert.notEqual(
    formatRelativeTimeCore(-5 * MIN, 'short', 'always', getFormat),
    getFormat('long', 'always').format(-5, 'minute'),
  )
})

test('forwards the EXACT requested style to the Intl formatter (proves no hardcoded long)', () => {
  let seenStyle
  const spy = (style, numeric) => {
    seenStyle = style
    return new Intl.RelativeTimeFormat('en', { style, numeric })
  }
  formatRelativeTimeCore(-5 * MIN, 'short', 'always', spy)
  assert.equal(seenStyle, 'short') // would have been 'long' before the fix
  formatRelativeTimeCore(-5 * MIN, 'long', 'always', spy)
  assert.equal(seenStyle, 'long')
})

test('long style is unchanged', () => {
  assert.equal(formatRelativeTimeCore(-5 * MIN, 'long', 'always', getFormat), '5 minutes ago')
  assert.equal(formatRelativeTimeCore(2 * HOUR, 'long', 'always', getFormat), 'in 2 hours')
})

test('narrow style uses compact suffixes and never calls the Intl formatter', () => {
  let called = false
  const spy = (style, numeric) => {
    called = true
    return new Intl.RelativeTimeFormat('en', { style, numeric })
  }
  assert.equal(formatRelativeTimeCore(-5 * MIN, 'narrow', 'always', spy), '5m ago')
  assert.equal(formatRelativeTimeCore(3 * HOUR, 'narrow', 'always', spy), 'in 3h')
  assert.equal(formatRelativeTimeCore(-2 * DAY, 'narrow', 'always', spy), '2d ago')
  assert.equal(called, false)
})

test('days render identically for short and long in en (so only sub-day units visibly differ)', () => {
  assert.equal(
    formatRelativeTimeCore(-2 * DAY, 'short', 'always', getFormat),
    formatRelativeTimeCore(-2 * DAY, 'long', 'always', getFormat),
  )
})

test('sub-second deltas keep the #626 narrow direction (sign of ms)', () => {
  assert.equal(formatRelativeTimeCore(500, 'narrow', 'always', getFormat), 'in 0s')
  assert.equal(formatRelativeTimeCore(-500, 'narrow', 'always', getFormat), '0s ago')
})

test('sub-second non-narrow defers to the injected formatter for second:0', () => {
  assert.equal(
    formatRelativeTimeCore(500, 'short', 'always', getFormat),
    getFormat('short', 'always').format(0, 'second'),
  )
})
