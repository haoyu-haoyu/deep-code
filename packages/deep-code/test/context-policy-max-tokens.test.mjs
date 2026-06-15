import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveDeepCodeContextPolicy } from '../src/deepcode/context-policy.mjs'

// resolveContextWindowTokens (the policy used by /status, the welcome banner and
// supportsOneMillionContext) must honor the legacy CLAUDE_CODE_MAX_CONTEXT_TOKENS
// alias, like getContextWindowForModel (utils/context.ts) already does for the
// runtime window — otherwise the display says 1M while the window is capped.

test('CLAUDE_CODE_MAX_CONTEXT_TOKENS caps the policy window (legacy alias)', () => {
  const p = resolveDeepCodeContextPolicy({
    env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000' },
    model: 'deepseek-v4-pro',
  })
  assert.equal(p.contextWindowTokens, 200000)
  assert.equal(p.supportsOneMillionContext, false)
})

test('without any override a v4 model still reports the 1M window', () => {
  const p = resolveDeepCodeContextPolicy({ env: {}, model: 'deepseek-v4-pro' })
  assert.equal(p.contextWindowTokens, 1_000_000)
  assert.equal(p.supportsOneMillionContext, true)
})

test('DEEPCODE_ and DEEPSEEK_ take precedence over the legacy CLAUDE_CODE_ alias', () => {
  const p1 = resolveDeepCodeContextPolicy({
    env: {
      DEEPCODE_MAX_CONTEXT_TOKENS: '300000',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000',
    },
    model: 'deepseek-v4-pro',
  })
  assert.equal(p1.contextWindowTokens, 300000)
  const p2 = resolveDeepCodeContextPolicy({
    env: {
      DEEPSEEK_MAX_CONTEXT_TOKENS: '400000',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000',
    },
    model: 'deepseek-v4-pro',
  })
  assert.equal(p2.contextWindowTokens, 400000)
})

test('a non-positive / invalid CLAUDE_CODE_ override is ignored (falls through)', () => {
  for (const bad of ['nonsense', '0', '-5', '']) {
    const p = resolveDeepCodeContextPolicy({
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: bad },
      model: 'deepseek-v4-pro',
    })
    assert.equal(p.contextWindowTokens, 1_000_000, `bad override ${JSON.stringify(bad)}`)
  }
})
