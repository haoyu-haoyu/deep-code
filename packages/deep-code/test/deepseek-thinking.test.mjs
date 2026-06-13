import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildDeepSeekRequest,
  normalizeDeepSeekThinking,
} from '../src/services/providers/deepseek.mjs'

const bodyOf = async env => {
  const request = await buildDeepSeekRequest({
    systemPrompt: ['s'],
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    env: { DEEPSEEK_API_KEY: 'sk-x', DEEPSEEK_CACHE_USER_ID: 'w', ...env },
  })
  return typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
}

test('normalizeDeepSeekThinking maps disable spellings to disabled, everything else to enabled', () => {
  for (const v of ['disabled', 'disable', 'false', '0', 'no', 'off', 'OFF', ' false ', 'DISABLED']) {
    assert.equal(normalizeDeepSeekThinking(v), 'disabled', `${JSON.stringify(v)} should disable`)
  }
  for (const v of ['enabled', 'adaptive', 'on', 'true', '1', 'anything', undefined, null, '']) {
    assert.equal(normalizeDeepSeekThinking(v), 'enabled', `${JSON.stringify(v)} should enable`)
  }
})

test('DEEPSEEK_THINKING falsy strings actually disable reasoning in the request body', async () => {
  for (const v of ['false', '0', 'off', 'no']) {
    const body = JSON.parse(await bodyOf({ DEEPSEEK_THINKING: v }))
    assert.equal(body.thinking.type, 'disabled', `DEEPSEEK_THINKING=${v} must disable`)
    // disabled requests carry no reasoning_effort
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
  }
})

test('default and non-disable thinking values keep the request body byte-identical (cache moat)', async () => {
  const def = await bodyOf({})
  const defParsed = JSON.parse(def)
  // the default reasoning request is unchanged by the fix
  assert.deepEqual(defParsed.thinking, { type: 'enabled' })
  assert.equal(defParsed.reasoning_effort, 'max')
  // 'enabled' / 'adaptive' / a bogus non-disable value all produce the SAME bytes as
  // the unset default — only the disable-intent strings change behavior.
  assert.equal(await bodyOf({ DEEPSEEK_THINKING: 'enabled' }), def)
  assert.equal(await bodyOf({ DEEPSEEK_THINKING: 'adaptive' }), def)
  assert.equal(await bodyOf({ DEEPSEEK_THINKING: 'on' }), def)
})
