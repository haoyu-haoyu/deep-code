import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'

import {
  clear,
  recordTurn,
  getWarmModels,
} from '../src/cache/deepseek-cache.mjs'

const PRO = 'deepseek-v4-pro'
const FLASH = 'deepseek-v4-flash'

beforeEach(() => clear())

test('a 0-hit/0-miss no-signal turn does NOT demote a warm model', () => {
  // A non-strict gateway can omit the prompt_cache_* fields → a turn recorded as
  // hit=0,miss=0. cacheHitRatio(0,0) is 0 only because of its 0/0 guard, not because
  // the lane went cold — so it must not overwrite the prior warm signal.
  recordTurn({ model: PRO, hit: 5000, miss: 100 })
  recordTurn({ model: PRO, hit: 0, miss: 0 })
  assert.equal(getWarmModels().has(PRO), true)
})

test('a REAL cold turn (signal present, hit < miss) DOES demote', () => {
  recordTurn({ model: PRO, hit: 5000, miss: 100 })
  recordTurn({ model: PRO, hit: 10, miss: 9000 })
  assert.equal(getWarmModels().has(PRO), false)
})

test('warmth is read through a no-signal gap to the most recent SIGNAL-bearing turn', () => {
  recordTurn({ model: PRO, hit: 900, miss: 100 }) // warm
  recordTurn({ model: FLASH, hit: 50, miss: 0 }) // unrelated
  recordTurn({ model: PRO, hit: 0, miss: 0 }) // no signal (most recent for PRO)
  assert.equal(getWarmModels().has(PRO), true)
})

test('a model whose only turns carry no signal is not warm', () => {
  recordTurn({ model: FLASH, hit: 0, miss: 0 })
  recordTurn({ model: FLASH, hit: 0, miss: 0 })
  assert.equal(getWarmModels().has(FLASH), false)
})

test('an ordinary warm most-recent turn is still warm (parity)', () => {
  recordTurn({ model: PRO, hit: 900, miss: 100 })
  assert.equal(getWarmModels().has(PRO), true)
})
