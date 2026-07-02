import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveContextSizingModel,
  AUTO_ROUTE_SIZING_MODEL,
} from '../src/utils/model/contextSizingModel.mjs'
import { resolveDeepCodeContextPolicy } from '../src/deepcode/context-policy.mjs'

test('resolveContextSizingModel maps the auto routing sentinel to a deepseek-v4 model', () => {
  assert.equal(resolveContextSizingModel('auto'), 'deepseek-v4-pro')
  assert.equal(resolveContextSizingModel('AUTO'), 'deepseek-v4-pro') // isAutoModelSetting lowercases
  assert.equal(resolveContextSizingModel('  auto  '), 'deepseek-v4-pro') // and trims
  assert.equal(AUTO_ROUTE_SIZING_MODEL, 'deepseek-v4-pro')
})

test('resolveContextSizingModel passes concrete / non-auto models through unchanged', () => {
  assert.equal(resolveContextSizingModel('deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(resolveContextSizingModel('deepseek-v4-flash'), 'deepseek-v4-flash')
  assert.equal(resolveContextSizingModel('claude-sonnet-4'), 'claude-sonnet-4')
  assert.equal(resolveContextSizingModel('automatic'), 'automatic') // not the sentinel
  assert.equal(resolveContextSizingModel(''), '')
  assert.equal(resolveContextSizingModel(undefined), undefined)
})

test('THE BUG vs THE FIX: auto sizing resolves to the 1M DeepSeek window, not the 200k fallback', () => {
  const env = {} // isolate from ambient DEEPCODE_MAX_CONTEXT_TOKENS / 1M-disable overrides
  // Raw 'auto' (the bug): isDeepSeekV4Model('auto')=false → 200k Anthropic fallback.
  const raw = resolveDeepCodeContextPolicy({ env, model: 'auto' })
  assert.equal(raw.contextWindowTokens, 200_000)
  // Resolved 'auto' (the fix): its deepseek-v4 routing target → 1M.
  const fixed = resolveDeepCodeContextPolicy({
    env,
    model: resolveContextSizingModel('auto'),
  })
  assert.equal(fixed.contextWindowTokens, 1_000_000)
  assert.equal(fixed.supportsOneMillionContext, true)
  assert.ok(
    fixed.autoCompactThresholdTokens > 900_000,
    `auto-compact threshold ${fixed.autoCompactThresholdTokens} should be ~967k, not ~167k`,
  )
  // Sizing now matches a concrete deepseek-v4-pro session (the model 'auto' runs).
  const pro = resolveDeepCodeContextPolicy({ env, model: 'deepseek-v4-pro' })
  assert.equal(fixed.contextWindowTokens, pro.contextWindowTokens)
  assert.equal(fixed.autoCompactThresholdTokens, pro.autoCompactThresholdTokens)
})

test('THE FIX: auto max-output resolves to the DeepSeek policy, not the 32k Anthropic default', () => {
  const env = {}
  const fixed = resolveDeepCodeContextPolicy({
    env,
    model: resolveContextSizingModel('auto'),
  })
  const pro = resolveDeepCodeContextPolicy({ env, model: 'deepseek-v4-pro' })
  assert.equal(fixed.maxOutputTokens.default, pro.maxOutputTokens.default)
  assert.equal(fixed.maxOutputTokens.upperLimit, pro.maxOutputTokens.upperLimit)
  assert.equal(fixed.maxOutputTokens.default, 64_000)
})
