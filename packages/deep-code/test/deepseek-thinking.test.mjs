import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildDeepSeekRequest,
  normalizeDeepSeekThinking,
} from '../src/services/providers/deepseek.mjs'
import {
  resolveDeepSeekThinkingMode,
  resolveAutoRouteThinking,
} from '../src/services/providers/resolveDeepSeekThinkingMode.mjs'
import {
  createDeepSeekCallModel,
  createProviderStreamContext,
} from '../src/query/deepseek-call-model.mjs'

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

// --- thinkingConfig sibling -> request `thinking` (was dropped at the call-model) ---

test('resolveDeepSeekThinkingMode disables ONLY on an explicit { type: "disabled" }', () => {
  assert.equal(resolveDeepSeekThinkingMode({ type: 'disabled' }), 'disabled')
  for (const c of [
    { type: 'enabled' },
    { type: 'adaptive' },
    { type: 'whatever' },
    {},
    undefined,
    null,
  ]) {
    assert.equal(resolveDeepSeekThinkingMode(c), undefined, `${JSON.stringify(c)} must NOT disable`)
  }
})

test('createProviderStreamContext forwards thinking, and omits it when undefined (byte-identical)', () => {
  const provider = { supports: () => false }
  const disabled = createProviderStreamContext({ provider, thinking: 'disabled' })
  assert.equal(disabled.thinking, 'disabled')
  const unset = createProviderStreamContext({ provider, thinking: undefined })
  assert.equal(Object.hasOwn(unset, 'thinking'), false, 'undefined thinking must be omitted')
})

test('resolveAutoRouteThinking lets an explicit caller disable win over the router decision', () => {
  // The auto-route wrapper used to blanket-overwrite thinking with the router's
  // task-based choice, clobbering an explicit { type: 'disabled' } from compact /
  // the hooks (which arrives as context.thinking==='disabled').
  assert.equal(resolveAutoRouteThinking('disabled', 'enabled', true), 'disabled')
  assert.equal(resolveAutoRouteThinking('disabled', 'disabled', true), 'disabled')
  // even if the provider lacks extended-thinking support, an explicit disable holds
  assert.equal(resolveAutoRouteThinking('disabled', 'enabled', false), 'disabled')
  // no explicit disable → defer to the router exactly as before (gated on support)
  assert.equal(resolveAutoRouteThinking(undefined, 'enabled', true), 'enabled')
  assert.equal(resolveAutoRouteThinking(undefined, 'disabled', true), 'disabled')
  assert.equal(resolveAutoRouteThinking(undefined, 'enabled', false), undefined)
})

test('queryDeepSeekModelWithStreaming threads a SIBLING thinkingConfig:disabled to the provider', async () => {
  // The bug: the call-model destructured only { messages, systemPrompt, tools,
  // signal, options } and dropped the sibling thinkingConfig, so an explicit
  // reasoning-OFF request still shipped reasoning. Drive the generator with a stub
  // provider that captures the context handed to streamQuery.
  let captured
  const provider = {
    supports: () => false,
    async *streamQuery(ctx) {
      captured = ctx
    },
  }
  const drive = async thinkingConfig => {
    captured = undefined
    const gen = createDeepSeekCallModel({ provider })({
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: [],
      tools: [],
      thinkingConfig,
      options: {},
    })
    // eslint-disable-next-line no-unused-vars
    for await (const _ of gen) {
      /* drain */
    }
    return captured
  }

  const disabled = await drive({ type: 'disabled' })
  assert.equal(disabled.thinking, 'disabled', 'a dropped sibling thinkingConfig was the bug')
  // Non-disable shapes leave the request untouched (no thinking key forwarded).
  const enabled = await drive({ type: 'enabled' })
  assert.equal(Object.hasOwn(enabled, 'thinking'), false)
  const none = await drive(undefined)
  assert.equal(Object.hasOwn(none, 'thinking'), false)
})
