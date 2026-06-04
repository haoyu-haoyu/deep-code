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
      // Force non-strict so the sandbox probe self-skips here rather than
      // hard-failing (strict is opt-in for the dedicated CI job only).
      DEEPCODE_SANDBOX_E2E_STRICT: '',
      DEEPSEEK_API_KEY: '',
      DEEPCODE_API_KEY: '',
    },
  })
}

for (const { script, label } of [
  { script: 'test:toolchain-e2e', label: 'tool-chain' },
  { script: 'test:acp-e2e', label: 'ACP allow_always' },
  { script: 'test:sandbox-network-e2e', label: 'sandbox network deny' },
]) {
  test(`${label} E2E script skips cleanly (exit 0, notice, no key) without DEEPCODE_REAL_E2E`, () => {
    const result = runSkip(script)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /skipped/i)
    assert.match(result.stdout, /DEEPCODE_REAL_E2E=1/)
    // No key may leak on EITHER stream — a notice on stdout must not mask a key
    // dumped to stderr.
    assert.doesNotMatch(result.stdout, /sk-/)
    assert.doesNotMatch(result.stderr ?? '', /sk-/)
  })
}

test('sandbox network-deny probe HARD-FAILS in STRICT mode when DEEPCODE_REAL_E2E is unset (no silent green)', () => {
  // STRICT means the dedicated CI job committed (via its preflight) to EXERCISING
  // enforcement, so an unset DEEPCODE_REAL_E2E there is a job misconfiguration,
  // not an external precondition — it must fail loudly (exit 1), not skip (exit 0).
  // Otherwise STRICT's "exercise-or-go-red" guarantee silently depends on a second
  // env var being set. (Run the script directly so npm's own exit handling can't
  // mask the code.)
  const result = spawnSync('node', [resolve(packageRoot, 'scripts/sandbox-network-e2e.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DEEPCODE_REAL_E2E: '', DEEPCODE_SANDBOX_E2E_STRICT: '1' },
  })
  assert.equal(result.status, 1, `expected hard-fail, got ${result.status}: ${result.stdout}`)
  assert.match(result.stderr, /FAILED \(strict\)/)
  assert.match(result.stderr, /DEEPCODE_REAL_E2E must be set/)
  assert.doesNotMatch(result.stdout, /sk-/)
  assert.doesNotMatch(result.stderr ?? '', /sk-/)
})

test('live-e2e probe scripts exist on disk', () => {
  assert.equal(existsSync(resolve(packageRoot, 'scripts/deepseek-toolchain-e2e.mjs')), true)
  assert.equal(existsSync(resolve(packageRoot, 'scripts/deepseek-acp-e2e.mjs')), true)
  assert.equal(existsSync(resolve(packageRoot, 'scripts/sandbox-network-e2e.mjs')), true)
})

// The sandbox network-deny probe is gated on the OS SANDBOX (bubblewrap + socat),
// not on the DeepSeek key — so it runs in its own job that installs those + the
// real runtime, and runs strict so it cannot go green without enforcing.
test('live-e2e sandbox-network job installs every prerequisite, verifies the real runtime, runs strict', () => {
  const yaml = readFileSync(liveYamlPath, 'utf8')
  // Isolate JUST the sandbox-network job block — from its key to the next top-level
  // job (2-space indent) or EOF — so these assertions are scoped to that job's
  // steps and stay correct even if it is no longer the last job. Each missing
  // prerequisite would make the probe self-skip → a green job that never enforces.
  const jobKey = '\n  sandbox-network:'
  const jobStart = yaml.indexOf(jobKey)
  assert.notEqual(jobStart, -1, 'live-e2e must define a sandbox-network job')
  const after = yaml.slice(jobStart + jobKey.length)
  const nextJob = after.search(/\n  [A-Za-z0-9_-]+:\n/)
  const job = nextJob === -1 ? after : after.slice(0, nextJob)
  //   - bubblewrap + socat: the Linux OS-sandbox deps (checkDependencies contract)
  assert.match(job, /run: sudo apt-get update && sudo apt-get install -y bubblewrap socat/, 'must apt-get install both bubblewrap AND socat')
  //   - the real @anthropic-ai/sandbox-runtime: the vendored build ships a no-op shim
  assert.match(
    job,
    /run: npm install --no-save @anthropic-ai\/sandbox-runtime@/,
    'must install the real sandbox-runtime (the vendored shim is a no-op)',
  )
  //   - the shim/deps preflight: removing it would re-open the false-green path, so
  //     guard both of its hard-fail checks with CODE-shaped patterns (not satisfiable
  //     by a comment that merely mentions the words)
  assert.match(job, /isSupportedPlatform\(\) !== true/, 'must verify the REAL runtime resolved (not the shim) before enforcing')
  assert.match(job, /SM\.checkDependencies\?\.\(\)/, 'must verify sandbox deps so a missing dep fails loudly, not skips')
  //   - strict mode: turns post-preflight "can't run" into a hard fail, so the job
  //     is "exercise enforcement or go red"
  assert.match(job, /DEEPCODE_SANDBOX_E2E_STRICT: '1'/, 'must run the probe in strict mode on the dedicated runner')
  assert.match(job, /run: npm run test:sandbox-network-e2e/, 'must actually run the sandbox network-deny probe')
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
