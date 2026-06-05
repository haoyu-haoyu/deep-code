import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 PR-E: applyFortressConfigFromSettings wires settings.fortress → the manager.
// fortressConfigLoader.ts imports expandPath + getOriginalCwd (impure), so — like the
// manager-delegation test — we run it via a bun --eval fixture: the self-contained
// fortress cores + a stubbed expandPath/getOriginalCwd + a recording mock manager.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const FORTRESS_FILES = [
  'src/sandbox-fortress/adapter/fortressConfigLoader.ts',
  'src/sandbox-fortress/rule-engine/configLoader.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
  'src/sandbox-fortress/networkDecision.mjs',
]

// stub expandPath: resolve ~ and relative against the (stubbed) original cwd, preserve
// globs + absolute paths — the same shape as the real expandPath (verified separately).
const PATH_STUB = `export const expandPath = (p, base) => {
  if (typeof p !== 'string') return p
  if (p.startsWith('/')) return p
  if (p.startsWith('~/')) return '/home/u/' + p.slice(2)
  if (p.startsWith('./')) return base + '/' + p.slice(2)
  return base + '/' + p
}
`
const STATE_STUB = `export const getOriginalCwd = () => '/test/cwd'\n`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-fortress-config-'))
  for (const rel of FORTRESS_FILES) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/utils/path.js', PATH_STUB],
    ['src/bootstrap/state.js', STATE_STUB],
  ]) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

function runLoaderProbe() {
  const root = buildFixture()
  const loaderPath = join(root, 'src/sandbox-fortress/adapter/fortressConfigLoader.ts')
  const script = `
    import { applyFortressConfigFromSettings } from ${JSON.stringify(loaderPath)}
    const calls = { rulesets: {}, effort: undefined, setRulesetCount: 0 }
    const manager = {
      setRuleset: (layer, rules) => { calls.rulesets[layer] = rules; calls.setRulesetCount++ },
      setEffortLevel: (e) => { calls.effort = e },
    }
    const warnings = applyFortressConfigFromSettings(manager, {
      fortress: {
        effort: 'high',
        rules: [
          { layer: 'org', resource: 'fs-write', pattern: '~/.ssh/**', action: 'deny' },
          { layer: 'user', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
          { resource: 'fs-write', pattern: './build', action: 'deny' }, // no layer → user
          { layer: 'user', resource: 'fs-write', pattern: '/x', action: 'nope' }, // invalid action → warn
        ],
      },
    })
    process.stdout.write(JSON.stringify({ calls, warnings }))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('applyFortressConfigFromSettings normalizes fs paths, groups by layer, sets every layer + effort', () => {
  const { calls, warnings } = runLoaderProbe()

  // setRuleset called for EVERY layer (so a removed layer would be cleared on reload)
  assert.equal(calls.setRulesetCount, 4)
  assert.deepEqual(calls.rulesets['builtin-default'], [])
  assert.deepEqual(calls.rulesets['agent'], [])

  // org: the fs-write deny, '~' normalized to absolute; glob preserved
  assert.deepEqual(calls.rulesets['org'], [
    { layer: 'org', resource: 'fs-write', pattern: '/home/u/.ssh/**', action: 'deny' },
  ])

  // user: a net-host (NOT path-normalized) + the no-layer fs-write (relative → absolute)
  assert.deepEqual(calls.rulesets['user'], [
    { layer: 'user', resource: 'net-host', pattern: 'evil.com', action: 'deny' },
    { layer: 'user', resource: 'fs-write', pattern: '/test/cwd/build', action: 'deny' },
  ])

  // effort applied; the invalid-action rule was dropped with a warning
  assert.equal(calls.effort, 'high')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /invalid action/)
})

test('applyFortressConfigFromSettings on absent fortress → clears every layer, no effort, no throw', () => {
  const root = buildFixture()
  const loaderPath = join(root, 'src/sandbox-fortress/adapter/fortressConfigLoader.ts')
  const script = `
    import { applyFortressConfigFromSettings } from ${JSON.stringify(loaderPath)}
    const calls = { rulesets: {}, effort: 'UNSET', count: 0 }
    const manager = {
      setRuleset: (layer, rules) => { calls.rulesets[layer] = rules; calls.count++ },
      setEffortLevel: (e) => { calls.effort = e },
    }
    const warnings = applyFortressConfigFromSettings(manager, {}) // no fortress block
    process.stdout.write(JSON.stringify({ calls, warnings }))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const { calls, warnings } = JSON.parse(result.stdout)
  // every layer cleared to []
  assert.equal(calls.count, 4)
  for (const layer of ['builtin-default', 'org', 'agent', 'user']) {
    assert.deepEqual(calls.rulesets[layer], [])
  }
  // no effort in settings → setEffortLevel NOT called (left at its default)
  assert.equal(calls.effort, 'UNSET')
  assert.deepEqual(warnings, [])
})
