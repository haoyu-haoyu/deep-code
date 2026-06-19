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
import { resolveDeepSeekRuntimeModel } from '../src/query/deepseek-call-model.mjs'

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

// --- resolveDeepSeekRuntimeModel: the SECOND resolution path also drops 'auto' -
//
// runtimeModel feeds the message model display, the cache-warmth record key, and
// the max-tokens model gate. It is resolved separately from body.model, so it
// must apply the same dropAuto contract or a phantom 'auto' leaks into those sinks
// while the wire actually runs deepseek-v4-pro.

// resolveDeepSeekRuntimeModel reads process.env directly; mutate + restore.
const withEnv = (env, fn) => {
  const keys = ['DEEPSEEK_MODEL', 'DEEPCODE_MODEL']
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  try {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, env)
    return fn()
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

const deepseekProvider = { name: 'deepseek' }
const otherProvider = { name: 'ollama' }

test("DeepSeek path: a caller model:'auto' does not leak — falls to env, which is dropped", () => {
  // model='auto' is not deepseek-prefixed, so it falls to the env fallback; with
  // DEEPSEEK_MODEL=auto that fallback is now also dropped → undefined (the wire
  // then substitutes the concrete default).
  withEnv({ DEEPSEEK_MODEL: 'auto' }, () => {
    assert.equal(resolveDeepSeekRuntimeModel('auto'), undefined)
    assert.equal(resolveDeepSeekRuntimeModel(undefined), undefined)
  })
})

test('DeepSeek path: DEEPSEEK_MODEL=auto / DEEPCODE_MODEL=auto env fallback is dropped', () => {
  withEnv({ DEEPSEEK_MODEL: 'auto' }, () =>
    assert.equal(resolveDeepSeekRuntimeModel(undefined), undefined),
  )
  withEnv({ DEEPCODE_MODEL: 'AUTO' }, () =>
    assert.equal(resolveDeepSeekRuntimeModel(undefined), undefined),
  )
})

test('DeepSeek path: a concrete env / deepseek-* model still passes through', () => {
  withEnv({ DEEPSEEK_MODEL: 'deepseek-v4-pro' }, () =>
    assert.equal(resolveDeepSeekRuntimeModel(undefined), 'deepseek-v4-pro'),
  )
  withEnv({}, () =>
    assert.equal(resolveDeepSeekRuntimeModel('deepseek-v4-flash'), 'deepseek-v4-flash'),
  )
  // 'deepseek-auto' is a real model name, not the sentinel — passes through.
  withEnv({}, () =>
    assert.equal(resolveDeepSeekRuntimeModel('deepseek-auto'), 'deepseek-auto'),
  )
})

test('non-DeepSeek provider: case/space-padded auto is dropped, not sent as a literal model', () => {
  for (const v of ['auto', 'AUTO', 'Auto', '  auto  ']) {
    assert.equal(
      resolveDeepSeekRuntimeModel(v, { provider: otherProvider }),
      undefined,
      `auto variant should drop: ${JSON.stringify(v)}`,
    )
  }
})

test('non-DeepSeek provider: a concrete model passes through; unset → undefined', () => {
  assert.equal(
    resolveDeepSeekRuntimeModel('gpt-4o', { provider: otherProvider }),
    'gpt-4o',
  )
  assert.equal(
    resolveDeepSeekRuntimeModel(undefined, { provider: otherProvider }),
    undefined,
  )
})

test('a DeepSeek provider object routes through the DeepSeek branch (not the non-DeepSeek one)', () => {
  withEnv({ DEEPSEEK_MODEL: 'auto' }, () =>
    assert.equal(
      resolveDeepSeekRuntimeModel('auto', { provider: deepseekProvider }),
      undefined,
    ),
  )
})
