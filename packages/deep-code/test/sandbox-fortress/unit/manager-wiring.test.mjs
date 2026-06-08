import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 wiring coverage (MED audit gap): the manager-delegation test proves the 12
// rule-engine methods delegate, but stubs OUT the two pieces of LIVE wiring that make
// the fortress actually enforce in production:
//   (B) manager.initialize() → applyFortressConfigFromSettings(REAL) → setRuleset/
//       setEffortLevel → resolveFortressDecision returns 'deny' (the config→enforcement
//       chain, incl. reload-clears-old-rules + subscribe-once);
//   (C) runtime.ts's `new FortressSandboxManager()` singleton IS the barrel's
//       `SandboxManager` (the explicit re-export shadows the `export *` of legacy).
// Both are TypeScript, so — like manager-delegation — we exercise them via a `bun --eval`
// subprocess over a FIXTURE. The difference: here the config loader + parser are the REAL
// files (only the leaf globals — base adapter, settings source, clock-free expandPath —
// are stubbed), so we test the genuine end-to-end chain, not a stand-in.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// REAL files (copied verbatim) — the wiring under test + its pure dependencies.
const REAL_FILES = [
  'src/sandbox-fortress/manager.ts',
  'src/sandbox-fortress/runtime.ts', // (C) the `new FortressSandboxManager()` singleton
  'src/utils/sandbox/sandbox-adapter.ts', // (C) the barrel that shadow-exports it
  'src/sandbox-fortress/adapter/fortressConfigLoader.ts', // (B) REAL — not stubbed
  'src/sandbox-fortress/rule-engine/configLoader.mjs', // (B) REAL parser
  'src/sandbox-fortress/networkDecision.mjs',
  'src/sandbox-fortress/observability/violationLog.mjs',
  'src/sandbox-fortress/rule-engine/managerState.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
  'src/sandbox-fortress/rule-engine/fsProjector.mjs',
]

// legacy.js stub: the BASE adapter. manager imports `SandboxManager as baseSandboxManager`
// (+ getSandboxBaseRuntimeConfig). initialize() must resolve so the fortress's then() runs.
// The __isLegacyStub marker + a DISTINCT object is the foil for (C): if the barrel's
// `SandboxManager` were the star-exported legacy one (no shadow), it would equal THIS.
const LEGACY_STUB = `
export const SandboxManager = {
  __isLegacyStub: true,
  initialize: () => Promise.resolve(),
  isSupportedPlatform: () => true,
  isSandboxEnabledInSettings: () => true,
  getLinuxGlobPatternWarnings: () => [],
  wrapWithSandbox: (command, binShell, customConfig) =>
    Promise.resolve(JSON.stringify({ customConfig: customConfig ?? null })),
}
export const getSandboxBaseRuntimeConfig = () => ({
  filesystem: { denyRead: [], allowRead: [], allowWrite: ['.'], denyWrite: [] },
  network: { allowedDomains: [], deniedDomains: [] },
})
`

const PROFILES_STUB = `export const mergeFortressFsDeltaIntoConfig = (fsDelta, customConfig) => customConfig ?? null\n`
const PLATFORM_STUB = `export const getPlatform = () => 'linux'\n`
const DEBUG_STUB = `export const logForDebugging = () => {}\n`

// (B) settings source: a MUTABLE settings object + a test setter, so we can flip the
// config and fire a reload. manager reads it via getSettings_DEPRECATED() each load.
const SETTINGS_STUB = `
let __settings = {}
export const getSettings_DEPRECATED = () => __settings
export const __setSettings = next => { __settings = next }
`

// (B) settings-change detector: capture the subscribed callback + count subscriptions
// (to prove subscribe-ONCE across repeated initialize()), and expose a manual fire.
const CHANGE_DETECTOR_STUB = `
let __cb = null
let __count = 0
export const settingsChangeDetector = { subscribe: cb => { __cb = cb; __count++; return () => {} } }
export const __fireChange = () => { if (__cb) __cb() }
export const __subscribeCount = () => __count
`

// (B) the leaf globals the REAL fortressConfigLoader needs: a deterministic cwd + a
// clock-free expandPath (absolute → unchanged; '~/' → home; relative → cwd-joined).
const STATE_STUB = `export const getOriginalCwd = () => '/test/cwd'\n`
const PATH_STUB = `
export const expandPath = (p, base) => {
  if (typeof p !== 'string') return p
  if (p.startsWith('/')) return p
  if (p.startsWith('~/')) return '/home/u/' + p.slice(2)
  return (base || '/test/cwd') + '/' + p
}
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-manager-wiring-'))
  for (const rel of REAL_FILES) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/sandbox-fortress/adapter/legacy.js', LEGACY_STUB],
    ['src/sandbox-fortress/adapter/per-tool-profiles.js', PROFILES_STUB],
    ['src/utils/platform.js', PLATFORM_STUB],
    ['src/utils/debug.js', DEBUG_STUB],
    ['src/utils/settings/settings.js', SETTINGS_STUB],
    ['src/utils/settings/changeDetector.js', CHANGE_DETECTOR_STUB],
    ['src/bootstrap/state.js', STATE_STUB],
    ['src/utils/path.js', PATH_STUB],
  ]) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

function runProbe(scriptBody) {
  const root = buildFixture()
  const P = rel => JSON.stringify(join(root, rel))
  const script = scriptBody(P)
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

// ── (B) the config→enforcement chain through the REAL loader ──────────────────────────
// NOTE on isolating a "rule matched" from the paranoid floor: at effort 'max' the DEFAULT
// decision is 'deny', so a deny on ANY path proves nothing about rule loading. We therefore
// load the RULES at effort 'off' (deny ⟺ an explicit rule matched, with an unmatched-path
// control), then exercise EFFORT application separately through the same reload chain.
test('initialize() loads settings.fortress through the REAL config loader → enforcement goes live', () => {
  const out = runProbe(P => `
    import { FortressSandboxManager } from ${P('src/sandbox-fortress/manager.ts')}
    import { __setSettings } from ${P('src/utils/settings/settings.js')}
    import { __fireChange, __subscribeCount } from ${P('src/utils/settings/changeDetector.js')}
    const out = {}

    // effort omitted → stays 'off', so a 'deny' decision can ONLY come from a matched rule.
    // The pattern is a TILDE path so the REAL loader's expandPath normalization is exercised
    // (the stub expands '~/secret' → '/home/u/secret').
    __setSettings({ fortress: { rules: [
      { layer: 'user', resource: 'fs-write', pattern: '~/secret', action: 'deny' },
    ] } })
    const m = new FortressSandboxManager()

    // BEFORE initialize: the constructor loaded no config → no rules → not a deny (inert).
    out.effortBefore = m.getCurrentEffort()
    out.decisionBefore = m.resolveFortressDecision('fs-write', '/home/u/secret').decision

    await m.initialize()

    // AFTER initialize: the REAL applyFortressConfigFromSettings parsed settings.fortress and
    // NORMALIZED the pattern (the stored rule is the EXPANDED absolute path). Proof of
    // normalization: the expanded form is denied, but the RAW '~/secret' is not (it would be
    // denied too if the loader had stored the pattern verbatim). And an UNRELATED path is not
    // denied (effort 'off' has no paranoid floor) — so a deny is a matched RULE, not a default.
    out.effortAfter = m.getCurrentEffort()
    out.decisionMatchedNormalized = m.resolveFortressDecision('fs-write', '/home/u/secret').decision
    out.decisionRawTilde = m.resolveFortressDecision('fs-write', '~/secret').decision
    out.decisionUnmatched = m.resolveFortressDecision('fs-write', '/not-a-rule').decision

    // RELOAD to a DIFFERENT LAYER (org) with a different path: applyFortressConfigFromSettings
    // calls setRuleset for EVERY layer (the new config has no 'user' rule → user is set to []),
    // so the old user-layer deny is genuinely CLEARED, not just shadowed, and the new org deny
    // is live. (Exercises the clear-every-layer-including-empty branch end-to-end.)
    __setSettings({ fortress: { rules: [
      { layer: 'org', resource: 'fs-write', pattern: '/other', action: 'deny' },
    ] } })
    __fireChange()
    out.reloadOldCleared = m.resolveFortressDecision('fs-write', '/home/u/secret').decision
    out.reloadNewActive = m.resolveFortressDecision('fs-write', '/other').decision

    // RELOAD raising effort to 'max' → proves EFFORT application through the same chain
    // (effort 'max' → paranoid → the default decision becomes 'deny').
    __setSettings({ fortress: { effort: 'max', rules: [] } })
    __fireChange()
    out.effortMax = m.getCurrentEffort()
    out.defaultMax = m.getDefaultDecision()

    // Subscribe-ONCE: a second initialize() must not double-subscribe (the #subscribed guard).
    await m.initialize()
    out.subscribeCount = __subscribeCount()

    process.stdout.write(JSON.stringify(out))
  `)

  // inert before the config load
  assert.equal(out.effortBefore, 'off')
  assert.notEqual(out.decisionBefore, 'deny')
  // live after — the genuine settings→parse→normalize→setRuleset→resolve chain
  assert.equal(out.effortAfter, 'off')
  assert.equal(out.decisionMatchedNormalized, 'deny') // the loaded fs-write deny matched (expanded form)
  assert.notEqual(out.decisionRawTilde, 'deny') // raw '~/secret' NOT stored → the loader expanded it
  assert.notEqual(out.decisionUnmatched, 'deny') // no paranoid floor → deny is the RULE, not a default
  // reload clears the OLD LAYER entirely + applies the new layer (no stale ruleset)
  assert.notEqual(out.reloadOldCleared, 'deny')
  assert.equal(out.reloadNewActive, 'deny')
  // effort applied through the reload: 'max' → paranoid → default decision 'deny'
  assert.equal(out.effortMax, 'max')
  assert.equal(out.defaultMax, 'deny')
  // subscribed exactly once across two initialize() calls
  assert.equal(out.subscribeCount, 1)
})

test('initialize() is best-effort: a throwing config load never blocks init', () => {
  const out = runProbe(P => `
    import { FortressSandboxManager } from ${P('src/sandbox-fortress/manager.ts')}
    import { __setSettings } from ${P('src/utils/settings/settings.js')}
    const out = {}
    // a hostile settings shape (rules getter throws) must not reject initialize()
    __setSettings({ get fortress() { throw new Error('boom') } })
    const m = new FortressSandboxManager()
    let threw = false
    try { await m.initialize() } catch { threw = true }
    out.initThrew = threw
    out.usable = m.getCurrentEffort() // still operable
    process.stdout.write(JSON.stringify(out))
  `)
  assert.equal(out.initThrew, false) // best-effort: never blocks init
  assert.equal(out.usable, 'off')
})

// ── (C) the runtime singleton IS the barrel's SandboxManager (the shadow export) ──────
test('the barrel re-exports the runtime FortressSandboxManager singleton AS SandboxManager (shadowing legacy)', () => {
  const out = runProbe(P => `
    import { SandboxManager, getSandboxBaseRuntimeConfig } from ${P('src/utils/sandbox/sandbox-adapter.ts')}
    import { fortressSandboxManager } from ${P('src/sandbox-fortress/runtime.ts')}
    import { FortressSandboxManager } from ${P('src/sandbox-fortress/manager.ts')}
    import { SandboxManager as legacySandboxManager } from ${P('src/sandbox-fortress/adapter/legacy.js')}
    const out = {}
    // the barrel's SandboxManager is the ONE instance runtime.ts constructed…
    out.barrelIsRuntimeSingleton = SandboxManager === fortressSandboxManager
    out.isFortressInstance = SandboxManager instanceof FortressSandboxManager
    // …and the explicit re-export SHADOWED the legacy one from the star re-export (not
    // equal, and the legacy stub is genuinely reachable so the inequality is meaningful).
    out.legacyStubReachable = legacySandboxManager?.__isLegacyStub === true
    out.shadowedLegacy = SandboxManager !== legacySandboxManager
    out.notLegacyStubShape = SandboxManager?.__isLegacyStub !== true
    // a NON-shadowed legacy name still flows through the star-export untouched.
    out.starExportWorks = typeof getSandboxBaseRuntimeConfig === 'function'
    process.stdout.write(JSON.stringify(out))
  `)
  assert.equal(out.barrelIsRuntimeSingleton, true)
  assert.equal(out.isFortressInstance, true)
  assert.equal(out.legacyStubReachable, true)
  assert.equal(out.shadowedLegacy, true)
  assert.equal(out.notLegacyStubShape, true)
  assert.equal(out.starExportWorks, true)
})
