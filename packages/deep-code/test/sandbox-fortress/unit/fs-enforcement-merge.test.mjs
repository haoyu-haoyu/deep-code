import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 PR-D: the R5-critical fs union. mergeFortressFsDeltaIntoConfig must START from
// the settings base and UNION (never replace) — because the sandbox-runtime REPLACES
// customConfig.filesystem.<arr> over its base per field, so dropping the base denylist
// would be a sandbox escape. per-tool-profiles.ts is TS importing 4 tool-name modules
// (its SandboxRuntimeConfig import is type-only → erased by bun), so we run it via a
// `bun --eval` fixture with those name modules stubbed, plus the real fsProjector core.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/per-tool-profiles.ts',
  'src/sandbox-fortress/rule-engine/fsProjector.mjs',
]
const NAME_STUBS = [
  ['src/tools/BashTool/toolName.js', "export const BASH_TOOL_NAME = 'Bash'\n"],
  ['src/tools/FileEditTool/constants.js', "export const FILE_EDIT_TOOL_NAME = 'Edit'\n"],
  ['src/tools/FileReadTool/prompt.js', "export const FILE_READ_TOOL_NAME = 'Read'\n"],
  ['src/tools/WebFetchTool/prompt.js', "export const WEB_FETCH_TOOL_NAME = 'WebFetch'\n"],
]

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-fs-merge-'))
  for (const rel of COPY) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of NAME_STUBS) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

function runMergeProbe() {
  const root = buildFixture()
  const profilesPath = join(root, 'src/sandbox-fortress/adapter/per-tool-profiles.ts')
  const projectorPath = join(root, 'src/sandbox-fortress/rule-engine/fsProjector.mjs')
  const script = `
    import { mergeFortressFsDeltaIntoConfig } from ${JSON.stringify(profilesPath)}
    import { fortressRulesToFsDelta } from ${JSON.stringify(projectorPath)}

    const base = {
      filesystem: { denyRead: ['/settings-r'], allowRead: ['/ar'], allowWrite: ['.'], denyWrite: ['/settings-w'] },
      network: { allowedDomains: ['ok.com'], deniedDomains: ['bad.com'] },
    }
    const delta = fortressRulesToFsDelta([
      { layer: 'org', resource: 'fs-read', pattern: '/secret', action: 'deny' }, // DEFERRED → not projected
      { layer: 'org', resource: 'fs-write', pattern: '/etc', action: 'deny' }, // absolute glob-free → denyWrite
      { layer: 'user', resource: 'fs-write', pattern: '/build', action: 'allow' }, // ALLOW → not projected
    ])

    const out = {}
    // no customConfig: base ∪ fortress (fortress only contributes denyWrite)
    const m1 = mergeFortressFsDeltaIntoConfig(delta, undefined, base)
    out.m1 = m1.filesystem
    out.m1net = m1.network
    // with a customConfig write-deny: base ∪ custom ∪ fortress
    const m2 = mergeFortressFsDeltaIntoConfig(delta, { filesystem: { denyWrite: ['/custom-w'] } }, base)
    out.m2denyWrite = m2.filesystem.denyWrite
    // empty delta: base unchanged (shape-wise)
    const m3 = mergeFortressFsDeltaIntoConfig({ denyWrite: [] }, undefined, base)
    out.m3 = m3.filesystem

    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('mergeFortressFsDeltaIntoConfig unions ONLY the fortress denyWrite floor onto the base (R5; never grants)', () => {
  const out = runMergeProbe()

  // R5: settings base denies ALWAYS preserved; fortress write-deny ADDED (absolute floor)
  assert.deepEqual(out.m1.denyWrite, ['/settings-w', '/etc'])
  // the fortress NEVER grants: allowWrite is the untouched base value (the fortress
  // 'allow /build' was dropped, not projected). denyRead/allowRead also untouched.
  assert.deepEqual(out.m1.allowWrite, ['.'])
  assert.deepEqual(out.m1.denyRead, ['/settings-r'])
  assert.deepEqual(out.m1.allowRead, ['/ar'])
  // network preserved (not nuked by the deny-only delta)
  assert.deepEqual(out.m1net, { allowedDomains: ['ok.com'], deniedDomains: ['bad.com'] })

  // base ∪ custom ∪ fortress write-denies — all three present, deduped
  assert.deepEqual(out.m2denyWrite, ['/settings-w', '/custom-w', '/etc'])

  // empty delta → base arrays unchanged
  assert.deepEqual(out.m3.denyWrite, ['/settings-w'])
  assert.deepEqual(out.m3.allowWrite, ['.'])
})
