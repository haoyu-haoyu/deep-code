import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_MODEL_SETTING,
  isAutoModelSetting,
} from '../src/utils/model/autoModelSetting.mjs'
import {
  resolveDeepSeekConfig,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_SMALL_MODEL,
} from '../src/services/providers/deepseek.mjs'

// Resolve with a clean env and no file unless overridden, so we test only the
// model/smallModel resolution (fileConfig: null skips disk IO).
const resolve = (overrides = {}, { env = {}, fileConfig = null } = {}) =>
  resolveDeepSeekConfig({ env, fileConfig, overrides })

// --- the sentinel ------------------------------------------------------------

test('isAutoModelSetting: matches the auto sentinel case/space-insensitively', () => {
  assert.equal(AUTO_MODEL_SETTING, 'auto')
  for (const v of ['auto', 'AUTO', 'Auto', '  auto  ', '\tauto\n']) {
    assert.equal(isAutoModelSetting(v), true, `expected auto: ${JSON.stringify(v)}`)
  }
  for (const v of ['deepseek-v4-pro', 'automatic', 'autopilot', '', '  ', undefined, null, 0, {}]) {
    assert.equal(isAutoModelSetting(v), false, `expected not-auto: ${JSON.stringify(v)}`)
  }
})

// --- resolveDeepSeekConfig: the 'auto' sentinel never reaches model ----------

test("a caller's model:'auto' resolves to the concrete pro default, not 'auto'", () => {
  const config = resolve({ model: AUTO_MODEL_SETTING })
  assert.equal(config.model, DEFAULT_DEEPSEEK_MODEL)
  assert.notEqual(config.model, AUTO_MODEL_SETTING)
})

test('DEEPSEEK_MODEL=auto and DEEPCODE_MODEL=auto both resolve to the pro default', () => {
  assert.equal(resolve({}, { env: { DEEPSEEK_MODEL: 'auto' } }).model, DEFAULT_DEEPSEEK_MODEL)
  assert.equal(resolve({}, { env: { DEEPCODE_MODEL: 'AUTO' } }).model, DEFAULT_DEEPSEEK_MODEL)
})

test('a config-file model of auto resolves to the pro default', () => {
  assert.equal(resolve({}, { fileConfig: { model: 'auto' } }).model, DEFAULT_DEEPSEEK_MODEL)
})

test('auto is SKIPPED, not mapped-to-default: a concrete config later in the chain wins', () => {
  // overrides.model='auto' is dropped → the concrete file model is honored.
  const config = resolve(
    { model: AUTO_MODEL_SETTING },
    { fileConfig: { model: 'deepseek-v4-pro-custom' } },
  )
  assert.equal(config.model, 'deepseek-v4-pro-custom')
})

test("smallModel:'auto' resolves to the flash default", () => {
  assert.equal(resolve({ smallModel: AUTO_MODEL_SETTING }).smallModel, DEFAULT_DEEPSEEK_SMALL_MODEL)
  assert.equal(
    resolve({}, { env: { DEEPSEEK_SMALL_MODEL: 'auto' } }).smallModel,
    DEFAULT_DEEPSEEK_SMALL_MODEL,
  )
})

// --- the common path is byte-identical ---------------------------------------

test('a concrete model passes through unchanged', () => {
  assert.equal(resolve({ model: 'deepseek-v4-pro' }).model, 'deepseek-v4-pro')
  assert.equal(resolve({}, { env: { DEEPSEEK_MODEL: 'deepseek-v4-flash' } }).model, 'deepseek-v4-flash')
})

test('all-unset resolves to the concrete defaults (not auto)', () => {
  const config = resolve()
  assert.equal(config.model, DEFAULT_DEEPSEEK_MODEL)
  assert.equal(config.smallModel, DEFAULT_DEEPSEEK_SMALL_MODEL)
})
