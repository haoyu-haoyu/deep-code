import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  effectiveContextWindowSize,
  MIN_EFFECTIVE_CONTEXT_WINDOW,
} from '../src/services/compact/effectiveContextWindowSize.mjs'

const RESERVED = 20_000 // typical MAX_OUTPUT_TOKENS_FOR_SUMMARY

test('a normal large window: just contextWindow - reserved (floor is a no-op)', () => {
  assert.equal(effectiveContextWindowSize(200_000, RESERVED, undefined), 180_000)
  assert.equal(effectiveContextWindowSize(1_000_000, RESERVED, undefined), 980_000)
})

test('a valid large override caps the window, then subtracts the reservation', () => {
  // min(200000, 100000) - 20000 = 80000
  assert.equal(effectiveContextWindowSize(200_000, RESERVED, '100000'), 80_000)
})

test('THE FIX: an override below the reservation floors instead of going negative', () => {
  // Pre-fix: min(200000,10000) - 20000 = -10000 → every threshold inverts → session bricks.
  const r = effectiveContextWindowSize(200_000, RESERVED, '10000')
  assert.equal(r, MIN_EFFECTIVE_CONTEXT_WINDOW)
  assert.ok(r > 0, 'never negative')
})

test('an override that would leave too little (e.g. 30000) is floored', () => {
  // 30000 - 20000 = 10000, which is below AUTOCOMPACT_BUFFER_TOKENS (13k) → would
  // invert the autocompact threshold; floor keeps it coherent.
  assert.equal(effectiveContextWindowSize(200_000, RESERVED, '30000'), MIN_EFFECTIVE_CONTEXT_WINDOW)
})

test('just above the floor boundary is honored', () => {
  // 45000 - 20000 = 25000 > 20000 floor → honored as-is.
  assert.equal(effectiveContextWindowSize(200_000, RESERVED, '45000'), 25_000)
})

test('invalid / non-positive overrides are ignored', () => {
  for (const env of ['abc', '0', '-5', '', '  ', undefined, null]) {
    assert.equal(
      effectiveContextWindowSize(200_000, RESERVED, env),
      180_000,
      `override ${JSON.stringify(env)} should be ignored`,
    )
  }
})

test('the result is ALWAYS >= MIN_EFFECTIVE_CONTEXT_WINDOW (no negative/zero threshold base)', () => {
  const windows = [1000, 20_000, 25_000, 100_000, 1_000_000]
  const reserveds = [8_000, 20_000, 32_000]
  const envs = [undefined, '1', '5000', '19999', '20000', '33000', '500000']
  for (const w of windows) {
    for (const rsv of reserveds) {
      for (const env of envs) {
        const r = effectiveContextWindowSize(w, rsv, env)
        assert.ok(
          r >= MIN_EFFECTIVE_CONTEXT_WINDOW,
          `effective ${r} >= floor ${MIN_EFFECTIVE_CONTEXT_WINDOW} (w=${w}, reserved=${rsv}, env=${env})`,
        )
      }
    }
  }
})

test('a leading-numeric override parses like parseInt (trailing junk ignored)', () => {
  // matches the original parseInt(env, 10) behavior
  assert.equal(effectiveContextWindowSize(200_000, RESERVED, '100000abc'), 80_000)
})
