import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyRouteHeuristic } from '../src/services/autoMode/classifyRouteHeuristic.mjs'

const c = m => classifyRouteHeuristic(m)

test('explicit speed request -> flash/off (wins even over a summarize verb)', () => {
  assert.deepEqual(c('Quickly summarize the last error.'), {
    model: 'flash', thinking: 'off', reason: 'speed_requested',
  })
})

test('trivial lookup -> flash/off', () => {
  assert.deepEqual(c('What is JSON?'), {
    model: 'flash', thinking: 'off', reason: 'read_only_trivial',
  })
})

// --- THE fix: read-only questions with an INCIDENTAL complex token must NOT
//     over-route to pro/max (the old branch-ordering bug) ---

test('read-only question mentioning "tests" -> pro/low, NOT pro/max', () => {
  assert.deepEqual(c('Are there any tests in this repo?'), {
    model: 'pro', thinking: 'low', reason: 'read_only_complex_topic',
  })
})

test('read-only "explain the debug flag" -> pro/low, NOT pro/max', () => {
  assert.deepEqual(c('Explain how the debug flag works.'), {
    model: 'pro', thinking: 'low', reason: 'read_only_complex_topic',
  })
})

test('read-only on a HARD topic -> pro/medium', () => {
  assert.deepEqual(c('Explain the architecture of the cache layer.'), {
    model: 'pro', thinking: 'medium', reason: 'read_only_hard_topic',
  })
})

test('long read-only lookup (no complex/hard topic) -> flash/low', () => {
  const long = 'Show me the list of configuration values that the settings loader reads from disk and from the environment, including every fallback default value it applies when a given key is entirely missing or blank, and please present them grouped by their source in a clear order.'
  assert.ok(long.length >= 200)
  assert.deepEqual(c(long), {
    model: 'flash', thinking: 'low', reason: 'read_only_lookup',
  })
})

// --- the full ladder up: hardest reasoning reaches xhigh ---

test('hardest reasoning (architecture design, an action) -> pro/xhigh', () => {
  assert.deepEqual(c('Design the architecture for a safe plugin runtime.'), {
    model: 'pro', thinking: 'xhigh', reason: 'hardest_reasoning',
  })
})

test('debugging a race condition -> pro/xhigh', () => {
  assert.deepEqual(c('Debug the race condition in the scheduler.'), {
    model: 'pro', thinking: 'xhigh', reason: 'hardest_reasoning',
  })
})

test('explicit depth request (no hard-domain word) -> pro/max', () => {
  assert.deepEqual(c('Carefully rewrite this function without changing behavior.'), {
    model: 'pro', thinking: 'max', reason: 'deep_reasoning_requested',
  })
})

test('complex multi-file change -> pro/max', () => {
  assert.deepEqual(
    c('Refactor the auth, routing, and settings modules and update tests.'),
    { model: 'pro', thinking: 'max', reason: 'complex_change' },
  )
})

test('single-file edit -> pro/high', () => {
  assert.deepEqual(c('Edit src/app.ts to add validation for empty input.'), {
    model: 'pro', thinking: 'high', reason: 'single_file_edit',
  })
})

// --- asymmetric default: when unsure, lean to a capable tier (NOT low) ---

test('ambiguous request -> pro/high (asymmetric default, never low)', () => {
  const r = c('Help me with the onboarding flow.')
  assert.equal(r.model, 'pro')
  assert.equal(r.thinking, 'high')
  assert.equal(r.reason, 'general_task')
})

test('empty / non-string input does not throw and defaults to pro/high', () => {
  assert.deepEqual(c(''), { model: 'pro', thinking: 'high', reason: 'general_task' })
  assert.deepEqual(c(null), { model: 'pro', thinking: 'high', reason: 'general_task' })
  assert.deepEqual(c(undefined), { model: 'pro', thinking: 'high', reason: 'general_task' })
})

// --- an action that merely MENTIONS tests still routes to max (no under-route) ---

test('an action containing "tests" (not a question) stays pro/max', () => {
  assert.deepEqual(c('Refactor the parser and its tests.'), {
    model: 'pro', thinking: 'max', reason: 'complex_change',
  })
})
