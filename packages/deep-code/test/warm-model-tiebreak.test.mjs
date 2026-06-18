import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  recordTurn,
  getWarmModels,
  clear,
} from '../src/cache/deepseek-cache.mjs'
import { applyWarmModelTieBreak } from '../src/services/autoMode/warmModelTieBreak.mjs'

beforeEach(() => clear())

// warm: hitRate 0.9 (>= 0.5). cold: hitRate 0.1 (< 0.5).
const warmTurn = model => recordTurn({ model, hit: 900, miss: 100 })
const coldTurn = model => recordTurn({ model, hit: 100, miss: 900 })

// --- getWarmModels (the enabler) ---------------------------------------------

test('recordTurn stores the model; getWarmModels returns warm models', () => {
  warmTurn('deepseek-v4-pro')
  coldTurn('deepseek-v4-flash')
  const warm = getWarmModels()
  assert.ok(warm.has('deepseek-v4-pro'), 'pro had a warm turn')
  assert.ok(!warm.has('deepseek-v4-flash'), 'flash latest turn was cold')
})

test('getWarmModels uses the MOST RECENT turn per model', () => {
  // pro: warm then cold → its latest turn is cold → NOT warm.
  warmTurn('deepseek-v4-pro')
  coldTurn('deepseek-v4-pro')
  // flash: cold then warm → its latest turn is warm → warm.
  coldTurn('deepseek-v4-flash')
  warmTurn('deepseek-v4-flash')
  const warm = getWarmModels()
  assert.ok(!warm.has('deepseek-v4-pro'), 'pro latest turn cold')
  assert.ok(warm.has('deepseek-v4-flash'), 'flash latest turn warm')
})

test('getWarmModels skips records with no model and respects minHitRate', () => {
  warmTurn('') // older site / unrecorded model
  recordTurn({ model: 'mid', hit: 600, miss: 400 }) // hitRate 0.6
  assert.deepEqual([...getWarmModels()], ['mid'])
  assert.equal(getWarmModels({ minHitRate: 0.7 }).has('mid'), false, '0.6 < 0.7 threshold')
  assert.equal(getWarmModels({ minHitRate: 0.5 }).has('mid'), true)
})

test('getWarmModels is empty with no turns and after clear', () => {
  assert.equal(getWarmModels().size, 0)
  warmTurn('deepseek-v4-pro')
  clear()
  assert.equal(getWarmModels().size, 0)
})

// --- applyWarmModelTieBreak (the pure tie-break) -----------------------------

const flash = (thinking = 'off') => ({ model: 'flash', thinking, source: 'router' })
const warmPro = new Set(['deepseek-v4-pro'])

test('borderline flash + warm pro + no speed → pro at low effort', () => {
  const out = applyWarmModelTieBreak(flash('off'), {
    message: 'are there any tests for the parser?',
    proModel: 'deepseek-v4-pro',
    warmModels: warmPro,
  })
  assert.equal(out.model, 'pro')
  assert.equal(out.thinking, 'low')
  assert.equal(out.reason, 'warm_pro_tiebreak')
  assert.equal(out.source, 'router', 'other fields preserved')
})

test('explicit speed request is NEVER overridden', () => {
  for (const msg of ['quick: what is x', 'fast lookup', 'briefly, what does this do', 'tldr the file']) {
    const out = applyWarmModelTieBreak(flash('off'), {
      message: msg,
      proModel: 'deepseek-v4-pro',
      warmModels: warmPro,
    })
    assert.equal(out.model, 'flash', `speed kept flash: ${msg}`)
  }
})

test('pro lane NOT warm → flash decision unchanged', () => {
  const decision = flash('off')
  const out = applyWarmModelTieBreak(decision, {
    message: 'what does this do',
    proModel: 'deepseek-v4-pro',
    warmModels: new Set(['deepseek-v4-flash']), // pro not in the warm set
  })
  assert.equal(out, decision, 'returned unchanged (no warm pro lane)')
})

test('a pro decision is left untouched (only flash is eligible)', () => {
  const decision = { model: 'pro', thinking: 'max', source: 'router' }
  assert.equal(
    applyWarmModelTieBreak(decision, { message: 'x', proModel: 'deepseek-v4-pro', warmModels: warmPro }),
    decision,
  )
})

test('missing proModel / warmModels / non-Set → unchanged', () => {
  const decision = flash('low')
  assert.equal(applyWarmModelTieBreak(decision, { message: 'x', warmModels: warmPro }), decision, 'no proModel')
  assert.equal(applyWarmModelTieBreak(decision, { message: 'x', proModel: 'deepseek-v4-pro' }), decision, 'no warmModels')
  assert.equal(
    applyWarmModelTieBreak(decision, { message: 'x', proModel: 'deepseek-v4-pro', warmModels: ['deepseek-v4-pro'] }),
    decision,
    'warmModels not a Set',
  )
})

test('end-to-end: recorded warm pro turn drives the tie-break', () => {
  warmTurn('deepseek-v4-pro')
  const out = applyWarmModelTieBreak(flash('low'), {
    message: 'list the exported functions',
    proModel: 'deepseek-v4-pro',
    warmModels: getWarmModels(),
  })
  assert.equal(out.model, 'pro')
  assert.equal(out.thinking, 'low')
})
