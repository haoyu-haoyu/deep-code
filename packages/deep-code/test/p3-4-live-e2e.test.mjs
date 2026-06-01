import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '..', '..')
const liveYamlPath = resolve(repoRoot, '.github/workflows/live-e2e.yml')

// --- the live-e2e probe scripts skip cleanly without a key ----------------
// Same contract as deepseek-cache-e2e.mjs: gated on DEEPCODE_REAL_E2E=1, exit 0
// + a skip notice when not set, and NEVER echo a key (no "sk-" in output). This
// is what makes the scripts safe to ship + run in plain CI.

function runSkip(scriptName) {
  return spawnSync('npm', ['run', scriptName, '--workspace', '@deepcode-ai/deep-code'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_REAL_E2E: '',
      DEEPSEEK_API_KEY: '',
      DEEPCODE_API_KEY: '',
    },
  })
}

for (const { script, label } of [
  { script: 'test:toolchain-e2e', label: 'tool-chain' },
  { script: 'test:acp-e2e', label: 'ACP allow_always' },
]) {
  test(`${label} E2E script skips cleanly (exit 0, notice, no key) without DEEPCODE_REAL_E2E`, () => {
    const result = runSkip(script)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /skipped/i)
    assert.match(result.stdout, /DEEPCODE_REAL_E2E=1/)
    assert.doesNotMatch(result.stdout, /sk-/)
  })
}

test('live-e2e probe scripts exist on disk', () => {
  assert.equal(existsSync(resolve(packageRoot, 'scripts/deepseek-toolchain-e2e.mjs')), true)
  assert.equal(existsSync(resolve(packageRoot, 'scripts/deepseek-acp-e2e.mjs')), true)
})

// --- the live-e2e workflow is non-blocking + key-guarded ------------------

test('live-e2e workflow exists and is non-trivial', () => {
  assert.equal(existsSync(liveYamlPath), true, `expected ${liveYamlPath} to exist`)
  assert.ok(readFileSync(liveYamlPath, 'utf8').length > 100)
})

test('live-e2e workflow never runs on PRs/pushes (so it cannot block a PR)', () => {
  const yaml = readFileSync(liveYamlPath, 'utf8')
  assert.match(yaml, /workflow_dispatch/, 'must be manually dispatchable')
  assert.match(yaml, /schedule:/, 'must run on a schedule')
  assert.match(yaml, /cron:/, 'schedule must specify cron')
  // It must NOT trigger on pull_request or push — otherwise it would block PRs
  // and leak a key requirement onto every contributor.
  const triggerBlock = yaml.slice(yaml.indexOf('on:'), yaml.indexOf('jobs:'))
  assert.doesNotMatch(triggerBlock, /pull_request/, 'must not trigger on pull_request')
  assert.doesNotMatch(triggerBlock, /\bpush:/, 'must not trigger on push')
})

test('live-e2e workflow runs every live probe and the binary smoke, keyed from secrets', () => {
  const yaml = readFileSync(liveYamlPath, 'utf8')
  assert.match(yaml, /secrets\.DEEPSEEK_API_KEY/, 'key must come from secrets, never hard-coded')
  for (const probe of [
    'test:real-cache-e2e',
    'test:reasoning-cost',
    'test:toolchain-e2e',
    'test:acp-e2e',
    'build:binaries',
  ]) {
    assert.match(yaml, new RegExp(probe.replace(/[:]/g, '[:]')), `live-e2e must run ${probe}`)
  }
  // Guarded so an unconfigured (no-secret) run skips instead of false-failing.
  assert.match(yaml, /DEEPSEEK_API_KEY/, 'jobs must reference the key for the guard')
  assert.match(yaml, /steps\.guard\.outputs\.run == 'true'/, 'live steps must be guarded on the key')
  // No literal key must ever appear in the workflow.
  assert.doesNotMatch(yaml, /sk-[a-f0-9]{16}/i, 'no literal API key in the workflow')
})
