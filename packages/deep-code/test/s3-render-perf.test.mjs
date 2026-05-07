import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readBranchedEnvBool,
  readBranchedEnvInt,
  readBranchedEnvTriState,
} from '../src/utils/branchedEnv.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('readBranchedEnvInt picks the first set name', () => {
  const env = { DEEPCODE_RENDER_CAP: '50', CLAUDE_CODE_RENDER_CAP: '200' }
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_RENDER_CAP', 'CLAUDE_CODE_RENDER_CAP'],
      75,
      env,
    ),
    50,
    'DeepCode-branded var must win over the upstream alias',
  )
})

test('readBranchedEnvInt falls back to legacy var when DeepCode unset', () => {
  const env = { DEEPCODE_RENDER_CAP: '', CLAUDE_CODE_RENDER_CAP: '120' }
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_RENDER_CAP', 'CLAUDE_CODE_RENDER_CAP'],
      75,
      env,
    ),
    120,
  )
})

test('readBranchedEnvInt uses the fallback for empty / non-positive values', () => {
  const cases = [
    [{}, 75],
    [{ DEEPCODE_RENDER_CAP: '' }, 75],
    [{ DEEPCODE_RENDER_CAP: '0' }, 75],
    [{ DEEPCODE_RENDER_CAP: '-5' }, 75],
    [{ DEEPCODE_RENDER_CAP: 'abc' }, 75],
    [{ DEEPCODE_RENDER_CAP: '100' }, 100],
    // Regression guards for parseInt's permissive behavior — these used
    // to silently coerce to garbage values before the strict regex.
    [{ DEEPCODE_RENDER_CAP: '20.5' }, 75],
    [{ DEEPCODE_RENDER_CAP: '75abc' }, 75],
    [{ DEEPCODE_RENDER_CAP: '0xff' }, 75],
    [{ DEEPCODE_RENDER_CAP: '07' }, 75],
    [{ DEEPCODE_RENDER_CAP: ' 100 ' }, 100],
    [{ DEEPCODE_RENDER_CAP: '\t100\n' }, 100],
    [{ DEEPCODE_RENDER_CAP: '+100' }, 75],
  ]
  for (const [env, expected] of cases) {
    assert.equal(
      readBranchedEnvInt(['DEEPCODE_RENDER_CAP'], 75, env),
      expected,
      `unexpected result for env=${JSON.stringify(env)}`,
    )
  }
})

test('readBranchedEnvTriState distinguishes unset from explicit false', () => {
  const cases = [
    [{}, 'unset'],
    [{ DEEPCODE_NO_FLICKER: '' }, 'unset'],
    [{ DEEPCODE_NO_FLICKER: '0' }, 'false'],
    [{ DEEPCODE_NO_FLICKER: 'false' }, 'false'],
    [{ DEEPCODE_NO_FLICKER: 'no' }, 'false'],
    [{ DEEPCODE_NO_FLICKER: '1' }, 'true'],
    [{ DEEPCODE_NO_FLICKER: 'true' }, 'true'],
    [{ DEEPCODE_NO_FLICKER: 'on' }, 'true'],
    [{ DEEPCODE_NO_FLICKER: 'YES' }, 'true'],
  ]
  for (const [env, expected] of cases) {
    assert.equal(
      readBranchedEnvTriState(
        ['DEEPCODE_NO_FLICKER', 'CLAUDE_CODE_NO_FLICKER'],
        env,
      ),
      expected,
      `tri-state for env=${JSON.stringify(env)}`,
    )
  }
})

test('readBranchedEnvBool returns true only for explicit truthy', () => {
  assert.equal(readBranchedEnvBool(['DEEPCODE_FOO'], {}), false)
  assert.equal(
    readBranchedEnvBool(['DEEPCODE_FOO'], { DEEPCODE_FOO: '0' }),
    false,
  )
  assert.equal(
    readBranchedEnvBool(['DEEPCODE_FOO'], { DEEPCODE_FOO: '1' }),
    true,
  )
})

test('readBranchedEnvTriState: DeepCode-branded var beats the legacy var', () => {
  // Both set with conflicting values — DeepCode-branded wins.
  const env = { DEEPCODE_NO_FLICKER: '0', CLAUDE_CODE_NO_FLICKER: '1' }
  assert.equal(
    readBranchedEnvTriState(
      ['DEEPCODE_NO_FLICKER', 'CLAUDE_CODE_NO_FLICKER'],
      env,
    ),
    'false',
    'DEEPCODE_NO_FLICKER=0 must override CLAUDE_CODE_NO_FLICKER=1',
  )
})

test(
  'fullscreen.ts: both DeepCode and legacy env-var names are present',
  () => {
    // Light smoke check that the two env vars stay co-located. We
    // deliberately don't assert ordering (DeepCode-first precedence) here
    // because that's covered by the runtime test "DeepCode-branded var
    // beats the legacy var" against readBranchedEnvTriState — both
    // fullscreen.ts and any future refactor that delegates to
    // branchedEnv.mjs would pass that runtime check, while this string
    // match would brittle out on cosmetic changes.
    const fullscreenSource = readFileSync(
      resolve(packageRoot, 'src/utils/fullscreen.ts'),
      'utf8',
    )
    assert.match(fullscreenSource, /DEEPCODE_NO_FLICKER/)
    assert.match(fullscreenSource, /CLAUDE_CODE_NO_FLICKER/)
  },
)
