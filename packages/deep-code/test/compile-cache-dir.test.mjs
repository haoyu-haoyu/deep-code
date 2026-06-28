import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveCompileCacheDir } from '../src/deepcode/compileCacheDir.mjs'

test('default: per-version dir under the DeepCode config home', () => {
  const dir = resolveCompileCacheDir({
    env: {},
    homeDir: '/home/u',
    nodeVersion: 'v22.21.1',
  })
  assert.equal(dir, join('/home/u', '.deepcode', 'compile-cache', 'v22.21.1'))
})

test('DEEPCODE_CONFIG_DIR overrides the home base', () => {
  const dir = resolveCompileCacheDir({
    env: { DEEPCODE_CONFIG_DIR: '/custom/cfg' },
    homeDir: '/home/u',
    nodeVersion: 'v22.21.1',
  })
  assert.equal(dir, join('/custom/cfg', 'compile-cache', 'v22.21.1'))
})

test('a user-set NODE_COMPILE_CACHE wins (returned unchanged)', () => {
  const dir = resolveCompileCacheDir({
    env: { NODE_COMPILE_CACHE: '/my/cache', DEEPCODE_CONFIG_DIR: '/custom/cfg' },
    homeDir: '/home/u',
    nodeVersion: 'v22.21.1',
  })
  assert.equal(dir, '/my/cache')
})

test('the dir is scoped per Node version (an upgrade gets a fresh dir)', () => {
  const a = resolveCompileCacheDir({ env: {}, homeDir: '/h', nodeVersion: 'v22.21.1' })
  const b = resolveCompileCacheDir({ env: {}, homeDir: '/h', nodeVersion: 'v24.0.0' })
  assert.notEqual(a, b)
  assert.ok(a.endsWith('v22.21.1'))
  assert.ok(b.endsWith('v24.0.0'))
})
