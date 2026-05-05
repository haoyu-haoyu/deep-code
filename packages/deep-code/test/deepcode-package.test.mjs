import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../../..')
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const innerPackage = JSON.parse(
  readFileSync(resolve(root, 'packages/deep-code/package.json'), 'utf8'),
)
const mainSource = readFileSync(
  resolve(root, 'packages/deep-code/src/main.tsx'),
  'utf8',
)
const managedEnvSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/managedEnvConstants.ts'),
  'utf8',
)

test('root package is branded as Deep Code', () => {
  assert.equal(rootPackage.name, 'deep-code')
  assert.deepEqual(rootPackage.workspaces, ['packages/deep-code'])
  assert.equal(rootPackage.bin.deepcode, 'packages/deep-code/deepcode.js')
  assert.equal(rootPackage.bin['deep-code'], 'packages/deep-code/deepcode.js')
  assert.equal(rootPackage.dependencies['@deepcode-ai/deep-code'], 'workspace:*')
  assert.equal('@anthropic-ai/claude-code' in rootPackage.dependencies, false)
})

test('inner package exposes Deep Code bins only', () => {
  assert.equal(innerPackage.name, '@deepcode-ai/deep-code')
  assert.equal(innerPackage.bin.deepcode, 'deepcode.js')
  assert.equal(innerPackage.bin['deep-code'], 'deepcode.js')
  assert.equal('claude' in innerPackage.bin, false)
  assert.match(innerPackage.description, /DeepSeek-native Deep Code/)
})

test('lockfile metadata matches Deep Code wrapper', () => {
  assert.equal(lockfile.name, 'deep-code')
  assert.equal(lockfile.packages[''].name, 'deep-code')
  assert.deepEqual(lockfile.packages[''].workspaces, ['packages/deep-code'])
  assert.equal(lockfile.packages[''].dependencies['@deepcode-ai/deep-code'], 'workspace:*')
  assert.equal(lockfile.packages['packages/deep-code'].name, '@deepcode-ai/deep-code')
  assert.equal('claude' in lockfile.packages['packages/deep-code'].bin, false)
})

test('root node_modules is not tracked as Deep Code source', () => {
  assert.equal(existsSync(resolve(root, 'packages/deep-code/deepcode.js')), true)
  assert.equal(existsSync(resolve(root, 'node_modules/.bin/claude')), false)
})

test('Deep Code package entrypoint executes the DeepSeek-native CLI', () => {
  for (const binName of ['deepcode', 'deep-code']) {
    const result = spawnSync('node', [resolve(root, rootPackage.bin[binName]), '--version'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '0.1.0-deepseek-native')
  }
})

test('Deep Code CLI advertises DeepSeek local toolchain E2E check', () => {
  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '--help',
  ], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /deepcode --tool-e2e/)
})

test('source CLI entrypoint is branded for Deep Code and DeepSeek model env', () => {
  assert.match(mainSource, /program\.name\('deepcode'\)/)
  assert.match(mainSource, /Deep Code - starts an interactive session/)
  assert.match(mainSource, /DEEPSEEK_MODEL/)
  assert.match(mainSource, /DEEPCODE_MODEL/)
  assert.doesNotMatch(mainSource, /const explicitModel = options\.model \|\| process\.env\.ANTHROPIC_MODEL/)
})

test('managed environment constants include DeepSeek native routing variables', () => {
  for (const key of [
    'DEEPSEEK_API_KEY',
    'DEEPCODE_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPCODE_BASE_URL',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'DEEPSEEK_SMALL_MODEL',
    'DEEPCODE_SMALL_MODEL',
    'DEEPSEEK_THINKING',
    'DEEPCODE_THINKING',
    'DEEPSEEK_REASONING_EFFORT',
    'DEEPCODE_REASONING_EFFORT',
    'DEEPCODE_CACHE_USER_ID',
  ]) {
    assert.match(managedEnvSource, new RegExp(`'${key}'`))
  }
})
