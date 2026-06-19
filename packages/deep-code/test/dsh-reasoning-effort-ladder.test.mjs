import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coerceDeepSeekEffort,
  DEEPSEEK_REASONING_EFFORTS,
  resolveEffortPickerIndex,
} from '../src/services/providers/deepseekEffort.mjs'
import { applyWireEffortPrecedence } from '../src/utils/wireEffortPrecedence.mjs'

// Reconstructions of the TWO old collapse functions (deepseek.mjs normalizeDeepSeekEffort
// and deepseek-call-model.mjs resolveDeepSeekReasoningEffort) for a differential.
function oldNormalize(value) {
  const n = String(value ?? 'max').toLowerCase()
  if (n === 'max' || n === 'xhigh') return 'max'
  return 'high'
}
function oldResolve(effortValue) {
  if (effortValue === undefined || effortValue === null) return undefined
  const n =
    typeof effortValue === 'string'
      ? effortValue.toLowerCase()
      : String(effortValue).toLowerCase()
  if (n === 'max' || n === 'xhigh') return 'max'
  return 'high'
}

const newNormalize = v => coerceDeepSeekEffort(v, { unset: 'max', fallback: 'high' })
const newResolve = v => coerceDeepSeekEffort(v, { unset: undefined, fallback: 'high' })

test('the server enum is the 5 probe-confirmed tiers', () => {
  assert.deepEqual([...DEEPSEEK_REASONING_EFFORTS], ['low', 'medium', 'high', 'max', 'xhigh'])
})

test('resolveEffortPickerIndex: current tier maps to its index across the full ladder', () => {
  const efforts = DEEPSEEK_REASONING_EFFORTS
  assert.equal(resolveEffortPickerIndex(efforts, 'low'), 0)
  assert.equal(resolveEffortPickerIndex(efforts, 'medium'), 1)
  assert.equal(resolveEffortPickerIndex(efforts, 'high'), 2)
  assert.equal(resolveEffortPickerIndex(efforts, 'max'), 3)
  assert.equal(resolveEffortPickerIndex(efforts, 'xhigh'), 4)
  assert.equal(resolveEffortPickerIndex(efforts, 'MAX'), 3, 'case-insensitive')
})

test('resolveEffortPickerIndex: unknown/unset falls back to the max index, never the deepest tier', () => {
  const efforts = DEEPSEEK_REASONING_EFFORTS
  for (const v of [undefined, null, '', 'bogus', 'auto']) {
    assert.equal(resolveEffortPickerIndex(efforts, v), 3, `fallback for ${JSON.stringify(v)} = max index`)
  }
  // fallback absent from the option list → 0 (never out of range)
  assert.equal(resolveEffortPickerIndex(['low', 'high'], 'bogus'), 0)
  assert.equal(resolveEffortPickerIndex(['low', 'high'], 'high'), 1)
})

test('the graded ladder now passes through faithfully (the fix)', () => {
  for (const e of ['low', 'medium', 'high', 'max', 'xhigh']) {
    assert.equal(newNormalize(e), e, `normalize ${e}`)
    assert.equal(newResolve(e), e, `resolve ${e}`)
  }
  // case-insensitive
  assert.equal(newNormalize('XHIGH'), 'xhigh')
  assert.equal(newResolve('Low'), 'low')
})

test('xhigh is no longer downgraded to max, low/medium no longer upgraded to high', () => {
  // the three behavior changes vs the old collapse
  assert.equal(oldNormalize('xhigh'), 'max')
  assert.equal(newNormalize('xhigh'), 'xhigh')
  assert.equal(oldNormalize('low'), 'high')
  assert.equal(newNormalize('low'), 'low')
  assert.equal(oldNormalize('medium'), 'high')
  assert.equal(newNormalize('medium'), 'medium')
})

test('default (unset) is byte-identical: normalize→max, resolve→undefined', () => {
  for (const v of [undefined, null]) {
    assert.equal(newNormalize(v), 'max', `normalize ${v} preserves the max default`)
    assert.equal(newResolve(v), undefined, `resolve ${v} preserves undefined`)
    assert.equal(newNormalize(v), oldNormalize(v))
    assert.equal(newResolve(v), oldResolve(v))
  }
})

test('unrecognized values still fall back to high (unchanged safety)', () => {
  for (const v of ['minimal', 'garbage', 'maxx', 'hi', '', '  ', '0', 'true']) {
    assert.equal(newNormalize(v), oldNormalize(v), `normalize ${JSON.stringify(v)}`)
    assert.equal(newResolve(v), oldResolve(v), `resolve ${JSON.stringify(v)}`)
    assert.equal(newNormalize(v), 'high')
  }
  // numbers/booleans coerce then fall back, like the old String()-based path
  for (const v of [0, 1, 42, true, false]) {
    assert.equal(newNormalize(v), oldNormalize(v), `normalize ${v}`)
    assert.equal(newResolve(v), oldResolve(v), `resolve ${v}`)
  }
})

test('DIFFERENTIAL: new === old for EVERY input except {low,medium,xhigh} (the intended passthroughs)', () => {
  const intended = new Set(['low', 'medium', 'xhigh'])
  const inputs = [
    undefined, null, '', '   ', '0', 'true', 'false', 'minimal', 'garbage', 'maxx',
    'low', 'LOW', 'medium', 'Medium', 'high', 'HIGH', 'max', 'MAX', 'xhigh', 'XHIGH',
    0, 1, 42, -1, true, false, 'reasoning', 'none', 'off',
  ]
  for (const v of inputs) {
    const norm = String(v ?? '').toLowerCase()
    if (intended.has(norm)) {
      // these are the only divergences and they are the fix
      assert.notEqual(newNormalize(v), oldNormalize(v), `expected divergence at ${JSON.stringify(v)}`)
    } else {
      assert.equal(newNormalize(v), oldNormalize(v), `normalize divergence at ${JSON.stringify(v)}`)
      assert.equal(newResolve(v), oldResolve(v), `resolve divergence at ${JSON.stringify(v)}`)
    }
  }
})

// --- wire effort precedence: CLAUDE_CODE_EFFORT_LEVEL must win over the session
// /effort value on the DeepSeek wire, exactly as every display surface promises ---

// envOverride is getEffortEnvOverride()'s result space: an EffortValue (explicit
// env level), null (env literally 'unset'/'auto'), or undefined (no env var).
test('applyWireEffortPrecedence: an explicit env level WINS over the session value (the bug)', () => {
  // DIV1: env=low + /effort high used to send high on the wire (appState shadowed
  // the env) while the display showed low. Now the wire matches the display.
  assert.equal(applyWireEffortPrecedence('low', 'high'), 'low')
  assert.equal(applyWireEffortPrecedence('xhigh', 'low'), 'xhigh')
  assert.equal(applyWireEffortPrecedence('high', undefined), 'high')
})

test('applyWireEffortPrecedence: explicit unset/auto (null) suppresses the session value', () => {
  // Mirrors resolveAppliedEffort returning undefined for envOverride === null:
  // the env override the display promises must also drop the session value here.
  assert.equal(applyWireEffortPrecedence(null, 'high'), undefined)
  assert.equal(applyWireEffortPrecedence(null, 'max'), undefined)
  assert.equal(applyWireEffortPrecedence(null, undefined), undefined)
})

test('applyWireEffortPrecedence: with no env override it returns the session value verbatim', () => {
  assert.equal(applyWireEffortPrecedence(undefined, 'low'), 'low')
  assert.equal(applyWireEffortPrecedence(undefined, 'max'), 'max')
})

test('applyWireEffortPrecedence: NO-COLLAPSE invariant — nothing set returns undefined, not a model default', () => {
  // CRITICAL: must NOT substitute the model default (the way resolveAppliedEffort
  // does) so resolveDeepSeekConfig's `?? DEEPSEEK_REASONING_EFFORT ?? … ?? 'max'`
  // fallback chain still runs and the common default request stays byte-identical.
  assert.equal(applyWireEffortPrecedence(undefined, undefined), undefined)
})

test('EQUIVALENCE: the leaf reproduces resolveAppliedEffort\'s env/session step for every input', () => {
  // The whole point of the fix is a single source of truth: the wire's
  // env-vs-session precedence must equal the display's. Reconstruct the display's
  // pre-model-default step (resolveAppliedEffort, effort.ts) and assert the leaf
  // returns the identical value across the full cartesian product.
  const displayEnvStep = (envOverride, appState) =>
    envOverride === null ? undefined : (envOverride ?? appState)

  const envs = [null, undefined, 'low', 'medium', 'high', 'max', 'xhigh']
  const appStates = [undefined, 'low', 'medium', 'high', 'max', 'xhigh']
  for (const env of envs) {
    for (const appState of appStates) {
      assert.equal(
        applyWireEffortPrecedence(env, appState),
        displayEnvStep(env, appState),
        `wire/display divergence at env=${JSON.stringify(env)} appState=${JSON.stringify(appState)}`,
      )
    }
  }
})

test('DIFFERENTIAL: the fix changes ONLY cases where BOTH an env override and a session value are set', () => {
  // OLD wire effective value (pre default): options.effortValue was the raw
  // appState, so resolveDeepSeekReasoningEffort(appState) won whenever appState
  // was set; the env was only consulted (by resolveDeepSeekConfig) when appState
  // was nullish. The fix lets a meaningful env override (an explicit level OR an
  // explicit 'unset'/'auto') take effect even when a session value is set — that
  // is the ONLY behavior change. With no env override the result is unchanged.
  const oldWirePreDefault = (envOverride, appState) =>
    appState !== undefined ? appState : (envOverride === null ? undefined : envOverride)

  const envs = [null, undefined, 'low', 'medium', 'high', 'max', 'xhigh']
  const appStates = [undefined, 'low', 'medium', 'high', 'max', 'xhigh']
  for (const env of envs) {
    for (const appState of appStates) {
      const oldV = oldWirePreDefault(env, appState)
      const newV = applyWireEffortPrecedence(env, appState)
      if (env === undefined) {
        // No env override → byte-identical to the old wire (and to the session value).
        assert.equal(newV, oldV, `no-env case changed at appState=${JSON.stringify(appState)}`)
        assert.equal(newV, appState)
        continue
      }
      // An env override is present. Any divergence from the old wire must be
      // confined to the case where a session value WAS set (the bug: the session
      // value used to shadow the env override). When no session value is set the
      // env override already applied, so old === new.
      if (newV !== oldV) {
        assert.notEqual(appState, undefined, `divergence without a session value at env=${JSON.stringify(env)}`)
        // new honors the env directive: an explicit level, or undefined for unset/auto.
        assert.equal(newV, env === null ? undefined : env)
        assert.equal(oldV, appState)
      }
    }
  }
})
