import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  warningBandTokens,
  errorBandTokens,
  WARNING_BAND_FLOOR_TOKENS,
} from '../src/services/compact/warningBands.mjs'

test('legacy/small windows keep the fixed 20k bands (byte-identical back-compat)', () => {
  // The Anthropic 200k models resolve to ~180k effective — both bands floor to 20k,
  // exactly today's behavior.
  for (const effective of [180_000, 200_000, 100_000, 50_000, 20_000]) {
    assert.equal(warningBandTokens(effective), 20_000, `warning @${effective}`)
    assert.equal(errorBandTokens(effective), 20_000, `error @${effective}`)
  }
  assert.equal(WARNING_BAND_FLOOR_TOKENS, 20_000)
})

test('a 1M DeepSeek window scales the bands to a useful fraction', () => {
  const effective = 980_000 // 1M window minus the 20k summary reserve
  assert.equal(warningBandTokens(effective), 98_000) // floor(980k * 0.10)
  assert.equal(errorBandTokens(effective), 58_800) // floor(980k * 0.06)
})

test('warning band is always >= error band (error sits closer to the threshold)', () => {
  for (const effective of [180_000, 333_000, 500_000, 980_000, 2_000_000]) {
    assert.ok(
      warningBandTokens(effective) >= errorBandTokens(effective),
      `warning >= error @${effective}`,
    )
  }
  // On a large window they genuinely differ (today they were both 20k).
  assert.notEqual(warningBandTokens(980_000), errorBandTokens(980_000))
})

test('bands never drop below the floor and tolerate junk input', () => {
  for (const bad of [0, -1, -1_000_000, NaN, Infinity, undefined, null, 'x', {}]) {
    assert.equal(warningBandTokens(bad), 20_000, `warning junk ${String(bad)}`)
    assert.equal(errorBandTokens(bad), 20_000, `error junk ${String(bad)}`)
  }
})

test('an intermediate window scales proportionally', () => {
  // effective 500k → warning floor(500k*0.10)=50k, error floor(500k*0.06)=30k.
  assert.equal(warningBandTokens(500_000), 50_000)
  assert.equal(errorBandTokens(500_000), 30_000)
})
