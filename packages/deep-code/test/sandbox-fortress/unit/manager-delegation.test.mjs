import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 wiring PR-B: FortressSandboxManager delegates its 12 rule-engine methods to
// the pure managerState factory (PR-A). manager.ts is TypeScript (Node 20 in CI can't
// strip types), so — like the integration test — we exercise it via a `bun --eval`
// subprocess (bun loads .ts natively; bun is set up in the CI Test job).
//
// Importing the REAL manager.ts pulls the whole app graph (legacy.ts → src/tools/…
// path aliases bun can't resolve from a bare eval). So we assemble a minimal FIXTURE:
// the self-contained fortress files (manager.ts + the 3 cores + violation/network) and
// a STUB base adapter — proving the 12 stubs were replaced by working delegations.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// fortress files to copy verbatim, relative to packageRoot (structure preserved so the
// inter-core relative imports resolve inside the fixture).
const FORTRESS_FILES = [
  'src/sandbox-fortress/manager.ts',
  'src/sandbox-fortress/networkDecision.mjs',
  'src/sandbox-fortress/observability/violationLog.mjs',
  'src/sandbox-fortress/rule-engine/managerState.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
]

// A minimal stub of the base adapter barrel. manager.ts imports `SandboxManager` (value)
// + `ISandboxManager` (type, erased by bun). Only isSupportedPlatform is exercised; the
// other base delegations are never called in this probe.
const ADAPTER_STUB = `export const SandboxManager = { isSupportedPlatform: () => true }\n`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-manager-delegation-'))
  for (const rel of FORTRESS_FILES) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  const adapterPath = join(root, 'src/utils/sandbox/sandbox-adapter.js')
  mkdirSync(dirname(adapterPath), { recursive: true })
  writeFileSync(adapterPath, ADAPTER_STUB)
  return root
}

function runManagerProbe() {
  const root = buildFixture()
  const managerPath = join(root, 'src/sandbox-fortress/manager.ts')
  const script = `
    import { FortressSandboxManager } from ${JSON.stringify(managerPath)}
    const m = new FortressSandboxManager()
    const out = {}

    // effort (sync get + async-by-interface set)
    out.effortDefault = m.getCurrentEffort()
    await m.setEffortLevel('max')
    out.effortAfter = m.getCurrentEffort()

    // dry-run
    out.dryRunBefore = m.isDryRunMode()
    m.enableDryRunMode(true)
    out.dryRunAfter = m.isDryRunMode()

    // rulesets (async-by-interface) + resolution
    await m.setRuleset('org', [{ layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny' }])
    out.rulesetLen = (await m.getRulesetByLayer('org')).rules.length
    out.effectiveLen = (await m.resolveEffectiveRules()).length

    // strictness remap (async-by-interface) — just confirm it resolves
    await m.setStrictnessByEffort({ off: 'paranoid', high: 'paranoid', max: 'paranoid' })

    // summary + feedback + violation db
    out.summaryStatic = m.buildCacheFriendlyConfigSummary().static
    out.feedbackEmpty = m.buildViolationFeedback() // null: nothing feeds the sync mirror yet (PR-D)
    out.dbHasList = typeof m.getViolationDb().listViolations === 'function'

    // profile (malformed input → normalized)
    m.setProfileForTool('Bash', { junk: 1, fileSystemMode: 'bogus' })
    out.profile = m.getProfileForTool('Bash')

    // a base-manager method still delegates to the (stubbed) base
    out.platformSupportedType = typeof m.isSupportedPlatform()

    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('FortressSandboxManager delegates all 12 rule-engine methods to the state machine', () => {
  const out = runManagerProbe()
  assert.equal(out.effortDefault, 'off')
  assert.equal(out.effortAfter, 'max')
  assert.equal(out.dryRunBefore, false)
  assert.equal(out.dryRunAfter, true)
  assert.equal(out.rulesetLen, 1)
  assert.equal(out.effectiveLen, 1)
  assert.match(out.summaryStatic, /^rsv1/)
  assert.equal(out.feedbackEmpty, null)
  assert.equal(out.dbHasList, true)
  // malformed profile normalized to a valid ToolSandboxProfile
  assert.deepEqual(out.profile, { toolName: 'Bash', fileSystemMode: 'workspace-write', networkMode: 'allow' })
  // base methods are untouched (still delegate to baseSandboxManager)
  assert.equal(out.platformSupportedType, 'boolean')
})
