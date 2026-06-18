import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isFlashDowngradeStrategy,
  lowerDeepSeekEffort,
  downgradeDeepSeekRetryBody,
} from '../src/services/providers/deepseek-recovery.mjs'
import { streamDeepSeekQuery } from '../src/services/providers/deepseek.mjs'

const FLASH = 'deepseek-v4-flash'

test('isFlashDowngradeStrategy matches only the _or_flash strategies', () => {
  assert.equal(isFlashDowngradeStrategy('exponential_backoff_or_flash'), true)
  assert.equal(isFlashDowngradeStrategy('lower_reasoning_effort_or_use_flash'), true)
  assert.equal(isFlashDowngradeStrategy('exponential_backoff'), false)
  assert.equal(isFlashDowngradeStrategy('none'), false)
  assert.equal(isFlashDowngradeStrategy(undefined), false)
})

test('lowerDeepSeekEffort steps one tier toward low; floor/unknown unchanged', () => {
  assert.equal(lowerDeepSeekEffort('xhigh'), 'max')
  assert.equal(lowerDeepSeekEffort('max'), 'high')
  assert.equal(lowerDeepSeekEffort('high'), 'medium')
  assert.equal(lowerDeepSeekEffort('medium'), 'low')
  assert.equal(lowerDeepSeekEffort('low'), 'low') // already the floor
  assert.equal(lowerDeepSeekEffort('MAX'), 'high') // case-insensitive
  assert.equal(lowerDeepSeekEffort('off'), 'off') // not in the ladder → unchanged
  assert.equal(lowerDeepSeekEffort(undefined), undefined)
})

test('downgradeDeepSeekRetryBody (object): routes to flash + lowers effort, new object', () => {
  const body = { model: 'deepseek-v4-pro', reasoning_effort: 'max', messages: [{ role: 'user' }] }
  const { body: out, changed } = downgradeDeepSeekRetryBody(body, { smallModel: FLASH })
  assert.equal(changed, true)
  assert.equal(out.model, FLASH)
  assert.equal(out.reasoning_effort, 'high')
  assert.deepEqual(out.messages, [{ role: 'user' }]) // unrelated fields preserved
  // input not mutated
  assert.equal(body.model, 'deepseek-v4-pro')
  assert.equal(body.reasoning_effort, 'max')
  assert.notEqual(out, body)
})

test('downgradeDeepSeekRetryBody (string): returns a downgraded JSON string', () => {
  const body = JSON.stringify({ model: 'deepseek-v4-pro', reasoning_effort: 'high' })
  const { body: out, changed } = downgradeDeepSeekRetryBody(body, { smallModel: FLASH })
  assert.equal(changed, true)
  assert.equal(typeof out, 'string')
  const parsed = JSON.parse(out)
  assert.equal(parsed.model, FLASH)
  assert.equal(parsed.reasoning_effort, 'medium')
})

test('downgradeDeepSeekRetryBody: model-only body still downgrades the model', () => {
  const { body: out, changed } = downgradeDeepSeekRetryBody({ model: 'deepseek-v4-pro' }, { smallModel: FLASH })
  assert.equal(changed, true)
  assert.equal(out.model, FLASH)
})

test('downgradeDeepSeekRetryBody: already flash + low → no-op (changed:false, same ref)', () => {
  const body = { model: FLASH, reasoning_effort: 'low' }
  const res = downgradeDeepSeekRetryBody(body, { smallModel: FLASH })
  assert.equal(res.changed, false)
  assert.equal(res.body, body) // unchanged reference, no needless re-serialize
})

test('downgradeDeepSeekRetryBody: invalid JSON / non-object → no-op', () => {
  assert.deepEqual(downgradeDeepSeekRetryBody('{not json', { smallModel: FLASH }), { body: '{not json', changed: false })
  const arr = [1, 2]
  assert.deepEqual(downgradeDeepSeekRetryBody(arr, { smallModel: FLASH }), { body: arr, changed: false })
  assert.deepEqual(downgradeDeepSeekRetryBody(null, { smallModel: FLASH }), { body: null, changed: false })
})

test('downgradeDeepSeekRetryBody: no smallModel + floor effort → no-op', () => {
  const body = { model: 'deepseek-v4-pro', reasoning_effort: 'low' }
  assert.equal(downgradeDeepSeekRetryBody(body, {}).changed, false) // no smallModel, effort already low
})

// ── integration: the retry loop actually applies the downgrade ───────────────

test('streamDeepSeekQuery downgrades the body on a 503 (_or_flash) retry', async () => {
  const bodies = []
  let call = 0
  for await (const _ of streamDeepSeekQuery({
    url: 'https://api.deepseek.com/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'deepseek-v4-pro', reasoning_effort: 'max', messages: [] },
    maxRetries: 2,
    sleep: () => Promise.resolve(), // no real backoff
    async fetch(_url, init) {
      bodies.push(JSON.parse(init.body))
      call += 1
      // first attempt: 503 (exponential_backoff_or_flash) → retry should downgrade
      if (call === 1) return new Response('unavailable', { status: 503 })
      // second attempt: succeed with a trivial SSE stream
      return new Response('data: [DONE]\n\n', { status: 200 })
    },
  })) {
    // drain
  }

  assert.equal(call, 2, 'retried exactly once after the 503')
  // first request was the original pro/max body ...
  assert.equal(bodies[0].model, 'deepseek-v4-pro')
  assert.equal(bodies[0].reasoning_effort, 'max')
  // ... the retry was downgraded to flash + one tier lower effort
  assert.equal(bodies[1].model, FLASH)
  assert.equal(bodies[1].reasoning_effort, 'high')
})

test('streamDeepSeekQuery does NOT downgrade on a plain backoff retry (429)', async () => {
  const bodies = []
  let call = 0
  for await (const _ of streamDeepSeekQuery({
    url: 'https://api.deepseek.com/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'deepseek-v4-pro', reasoning_effort: 'max', messages: [] },
    maxRetries: 2,
    sleep: () => Promise.resolve(),
    async fetch(_url, init) {
      bodies.push(JSON.parse(init.body))
      call += 1
      if (call === 1) return new Response('rate limited', { status: 429 })
      return new Response('data: [DONE]\n\n', { status: 200 })
    },
  })) {
    // drain
  }

  assert.equal(call, 2)
  // 429 = exponential_backoff (NOT _or_flash) → identical body re-sent, no downgrade
  assert.equal(bodies[1].model, 'deepseek-v4-pro')
  assert.equal(bodies[1].reasoning_effort, 'max')
})
