import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 wiring PR-B/PR-D: FortressSandboxManager delegates its 12 rule-engine methods
// to the pure managerState factory, and (PR-D) its wrapWithSandbox override projects
// fortress rules to OS fs deltas. manager.ts is TypeScript (Node 20 in CI can't strip
// types), so — like the integration test — we exercise it via a `bun --eval`
// subprocess over a minimal FIXTURE: the self-contained fortress files + a STUB base
// adapter (legacy.js: a wrapWithSandbox recorder + getSandboxBaseRuntimeConfig) and a
// STUB per-tool-profiles.js (a marker mergeFortressFsDeltaIntoConfig). This isolates
// the manager's branching (inert passthrough vs enforcement) from the real merge —
// the real R5 union is tested separately in the integration test.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const FORTRESS_FILES = [
  'src/sandbox-fortress/manager.ts',
  'src/sandbox-fortress/networkDecision.mjs',
  'src/sandbox-fortress/observability/violationLog.mjs',
  'src/sandbox-fortress/rule-engine/managerState.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
  'src/sandbox-fortress/rule-engine/fsProjector.mjs',
]

// legacy.js stub: manager.ts imports SandboxManager (value) + getSandboxBaseRuntimeConfig
// + the type ISandboxManager (erased by bun). wrapWithSandbox records its customConfig
// arg so we can prove inert passthrough vs enforcement. getSandboxBaseRuntimeConfig
// returns a base carrying a settings-derived deny (so we can prove R5: base preserved).
const LEGACY_STUB = `
export const SandboxManager = {
  isSupportedPlatform: () => true,
  isSandboxEnabledInSettings: () => true,
  getLinuxGlobPatternWarnings: () => ['base-warning'],
  wrapWithSandbox: (command, binShell, customConfig, abortSignal, toolName) =>
    Promise.resolve(JSON.stringify({ customConfig: customConfig ?? null })),
}
export const getSandboxBaseRuntimeConfig = () => ({
  filesystem: { denyRead: [], allowRead: [], allowWrite: ['.'], denyWrite: ['/settings-w'] },
  network: { allowedDomains: [], deniedDomains: [] },
})
`

// platform stub: force 'linux' so the fortress glob-warning path is exercised.
const PLATFORM_STUB = `export const getPlatform = () => 'linux'\n`

// PR-E added imports to manager.ts (config-loading on initialize). This test does NOT
// call initialize() — it exercises the 12 methods + wrapWithSandbox — so these are
// inert stubs that only need to RESOLVE at module load.
const CONFIG_LOADER_STUB = `export const applyFortressConfigFromSettings = () => []\n`
const SETTINGS_STUB = `export const getSettings_DEPRECATED = () => ({})\n`
const CHANGE_DETECTOR_STUB = `export const settingsChangeDetector = { subscribe: () => () => {} }\n`
const DEBUG_STUB = `export const logForDebugging = () => {}\n`

// per-tool-profiles.js stub: a marker merge so the test sees exactly what the override
// passed (the projected delta + the base) without pulling the real tool-name deps.
const PROFILES_STUB = `
export const mergeFortressFsDeltaIntoConfig = (fsDelta, customConfig, baseConfig) => ({
  __merged: true, fsDelta, customConfig: customConfig ?? null, baseConfig,
})
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-manager-delegation-'))
  for (const rel of FORTRESS_FILES) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/sandbox-fortress/adapter/legacy.js', LEGACY_STUB],
    ['src/sandbox-fortress/adapter/per-tool-profiles.js', PROFILES_STUB],
    ['src/utils/platform.js', PLATFORM_STUB],
    ['src/sandbox-fortress/adapter/fortressConfigLoader.js', CONFIG_LOADER_STUB],
    ['src/utils/settings/settings.js', SETTINGS_STUB],
    ['src/utils/settings/changeDetector.js', CHANGE_DETECTOR_STUB],
    ['src/utils/debug.js', DEBUG_STUB],
  ]) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
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

    // rulesets (async-by-interface) + resolution — a WRITE deny so PR-D projects it
    await m.setRuleset('org', [{ layer: 'org', resource: 'fs-write', pattern: '/secret', action: 'deny' }])
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

    // base-manager method still delegates to the (stubbed) base
    out.platformSupportedType = typeof m.isSupportedPlatform()

    // ── PR-D wrapWithSandbox: ENFORCEMENT path (a fortress WRITE deny is set above) ──
    const enforced = JSON.parse(await m.wrapWithSandbox('echo hi', '/bin/sh', undefined, undefined, 'Bash'))
    out.enforcedMerged = enforced.customConfig && enforced.customConfig.__merged === true
    out.enforcedDelta = enforced.customConfig && enforced.customConfig.fsDelta
    out.enforcedBaseDeny = enforced.customConfig && enforced.customConfig.baseConfig.filesystem.denyWrite

    // ── PR-D wrapWithSandbox: INERT path (no fortress fs rules → untouched customConfig) ──
    const inertMgr = new FortressSandboxManager()
    const inert = JSON.parse(await inertMgr.wrapWithSandbox('echo hi', '/bin/sh', undefined, undefined, 'Bash'))
    out.inertCustomConfig = inert.customConfig // must be null (the untouched undefined → ?? null)
    // a passed customConfig is forwarded UNTOUCHED when inert
    const inert2 = JSON.parse(await inertMgr.wrapWithSandbox('echo hi', '/bin/sh', { marker: 'orig' }, undefined, 'Bash'))
    out.inertPassThrough = inert2.customConfig

    // ── PR-D Linux glob warning: a fortress fs-write GLOB deny is surfaced (not silent) ──
    const gm = new FortressSandboxManager()
    await gm.setRuleset('user', [
      { layer: 'user', resource: 'fs-write', pattern: '/home/*/.ssh/**', action: 'deny' }, // abs mid glob → warn
      { layer: 'user', resource: 'fs-write', pattern: 'secrets/**', action: 'deny' }, // non-absolute → warn
      { layer: 'user', resource: 'fs-write', pattern: '/etc/passwd', action: 'deny' }, // abs concrete → not warned
    ])
    out.globWarnings = gm.getLinuxGlobPatternWarnings()
    // the inert manager (no glob rules) returns only the base warning
    out.inertGlobWarnings = inertMgr.getLinuxGlobPatternWarnings()

    // ── PR-F: resolveFortressDecision (the org fs-write deny '/secret' is set above) ──
    out.decisionSecret = m.resolveFortressDecision('fs-write', '/secret').decision // matched deny
    // recordFortressViolation feeds the sync mirror → buildViolationFeedback
    m.recordFortressViolation({ id: 'pf', timestamp: 1, event: { line: 'pr-f test violation' }, toolName: 'Edit' })
    out.feedbackAfterRecord = m.buildViolationFeedback()

    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('FortressSandboxManager delegates rule-engine methods + enforces/passes-through wrapWithSandbox', () => {
  const out = runManagerProbe()
  // delegation
  assert.equal(out.effortDefault, 'off')
  assert.equal(out.effortAfter, 'max')
  assert.equal(out.dryRunBefore, false)
  assert.equal(out.dryRunAfter, true)
  assert.equal(out.rulesetLen, 1)
  assert.equal(out.effectiveLen, 1)
  assert.match(out.summaryStatic, /^rsv1/)
  assert.equal(out.feedbackEmpty, null)
  assert.equal(out.dbHasList, true)
  assert.deepEqual(out.profile, { toolName: 'Bash', fileSystemMode: 'workspace-write', networkMode: 'allow' })
  assert.equal(out.platformSupportedType, 'boolean')

  // PR-D enforcement: the write-deny rule is projected + merge invoked with the base
  assert.equal(out.enforcedMerged, true)
  assert.deepEqual(out.enforcedDelta.denyWrite, ['/secret'])
  // R5 signal: the settings-derived base deny is the merge's starting point
  assert.deepEqual(out.enforcedBaseDeny, ['/settings-w'])

  // PR-D inert: no fortress fs rules → customConfig forwarded UNTOUCHED (no synthesized arrays)
  assert.equal(out.inertCustomConfig, null) // undefined stayed undefined (recorder maps to null)
  assert.deepEqual(out.inertPassThrough, { marker: 'orig' })

  // PR-D Linux warning: base + the abs mid-glob + the non-absolute deny; abs concrete
  // excluded. Order follows resolveEffectiveRules' canonical total-order (deterministic).
  assert.equal(out.globWarnings[0], 'base-warning')
  assert.deepEqual(
    [...out.globWarnings].slice(1).sort(),
    ['fs-write deny /home/*/.ssh/**', 'fs-write deny secrets/**'].sort(),
  )
  // no fortress rules → only the base warning (no spurious fortress entry)
  assert.deepEqual(out.inertGlobWarnings, ['base-warning'])

  // PR-F: resolveFortressDecision matches the deny rule; recordFortressViolation surfaces
  assert.equal(out.decisionSecret, 'deny')
  assert.match(out.feedbackAfterRecord, /pr-f test violation/)
})
