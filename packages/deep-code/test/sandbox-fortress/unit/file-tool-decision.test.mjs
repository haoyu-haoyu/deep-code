import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 PR-F: checkFortressFileDecision maps a fortress decision → a PermissionDecision
// (deny/ask) or null (defer) for the file tools. It imports the live SandboxManager +
// expandPath, so — like the other adapter tests — we run it via a bun --eval fixture
// with a stubbed SandboxManager (decision + recorder) and expandPath.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/fileToolDecision.ts',
  'src/sandbox-fortress/rule-engine/fortressPermission.mjs',
]

const PATH_STUB = `export const expandPath = (p) => {
  if (typeof p === 'string' && p.includes('THROW')) throw new Error('boom') // simulate a resolution error
  return (typeof p === 'string' && p.startsWith('/')) ? p : '/cwd/' + p
}
`

// SandboxManager stub: decisions keyed by a path substring; records violations to a
// shared array the probe can read; dry-run togglable.
const ADAPTER_STUB = `
const recorded = []
let dryRun = false
export const SandboxManager = {
  isDryRunMode: () => dryRun,
  resolveFortressDecision: (resource, target) => {
    if (target.includes('/errlookup')) return { decision: 'deny', rule: null, reason: 'error:fail-safe' } // internal error
    if (target.includes('/deny')) return { decision: 'deny', rule: { layer: 'user', resource, pattern: target, action: 'deny' }, reason: 'match' }
    if (target.includes('/ask')) return { decision: 'ask', rule: { layer: 'user', resource, pattern: target, action: 'ask' }, reason: 'match' }
    if (target.includes('/paranoid')) return { decision: 'deny', rule: null, reason: 'no-match:deny' }
    return { decision: 'ask', rule: null, reason: 'no-match:ask' }
  },
  recordFortressViolation: (r) => recorded.push(r),
}
export const __recorded = recorded
export const __setDryRun = (v) => { dryRun = v }
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-file-tool-decision-'))
  for (const rel of COPY) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/utils/path.js', PATH_STUB],
    ['src/utils/sandbox/sandbox-adapter.js', ADAPTER_STUB],
  ]) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

function runProbe() {
  const root = buildFixture()
  const decisionPath = join(root, 'src/sandbox-fortress/adapter/fileToolDecision.ts')
  const adapterPath = join(root, 'src/utils/sandbox/sandbox-adapter.js')
  const script = `
    import { checkFortressFileDecision } from ${JSON.stringify(decisionPath)}
    import { __recorded, __setDryRun } from ${JSON.stringify(adapterPath)}
    const out = {}
    out.deny = checkFortressFileDecision('fs-read', '/deny/secret', 'Read')
    out.ask = checkFortressFileDecision('fs-write', '/ask/x', 'Edit')
    out.defer = checkFortressFileDecision('fs-read', '/other/x', 'Read')
    out.paranoid = checkFortressFileDecision('fs-write', '/paranoid/x', 'Write')
    // SYMLINK FIX: the resolved set [alias, realTarget] — a deny on ANY resolved member blocks
    out.symlinkDeny = checkFortressFileDecision('fs-read', ['/workspace/link', '/deny/real'], 'Read')
    out.symlinkSafe = checkFortressFileDecision('fs-read', ['/workspace/a', '/workspace/b'], 'Read')
    out.recordedAfter = __recorded.length // only the matched deny → 1
    out.recordedFirst = __recorded[0]
    // relative path is expanded to absolute before lookup
    out.relativeExpanded = checkFortressFileDecision('fs-write', 'deny/rel', 'Edit') // '/cwd/deny/rel' → contains /deny → deny
    __setDryRun(true)
    out.dryRunDeny = checkFortressFileDecision('fs-read', '/deny/y', 'Read') // defers but records
    out.recordedAfterDryRun = __recorded.length
    out.recordedDryRun = __recorded[__recorded.length - 1]
    // INTERNAL-ERROR FAIL-SAFE: a member resolution error OR a fortress lookup error
    // (reason 'error:fail-safe') DEFERS the whole call — never blocks on an internal error.
    out.memberResolveError = checkFortressFileDecision('fs-read', ['/deny/x', '/THROW/y'], 'Read')
    out.lookupError = checkFortressFileDecision('fs-read', '/errlookup/x', 'Read')
    out.recordedFinal = __recorded.length // unchanged: error paths defer before recording
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('checkFortressFileDecision: deny→deny, matched-ask→ask, no-match→defer, paranoid→deny, dry-run→defer+record', () => {
  const out = runProbe()

  assert.equal(out.deny.behavior, 'deny')
  assert.match(out.deny.message, /Sandbox Fortress/)
  assert.equal(out.deny.decisionReason.type, 'other')

  assert.equal(out.ask.behavior, 'ask')

  assert.equal(out.defer, null) // no-match 'ask' default → defer to host

  assert.equal(out.paranoid.behavior, 'deny') // no-match paranoid deny → block

  // SYMLINK FIX: a deny on the resolved target blocks even when the alias is clean; a set
  // with no denied member defers.
  assert.equal(out.symlinkDeny.behavior, 'deny')
  assert.equal(out.symlinkSafe, null)

  // a MATCHED deny records a violation (the single deny + the symlink-set deny = 2);
  // ask/defer/paranoid/safe-set did not record
  assert.equal(out.recordedAfter, 2)
  assert.equal(out.recordedFirst.toolName, 'Read')
  assert.equal(out.recordedFirst.dryRun, false)
  assert.match(out.recordedFirst.event.line, /denied fs-read/)

  // relative path expanded to absolute, then matched
  assert.equal(out.relativeExpanded.behavior, 'deny')

  // DRY-RUN: a matched deny does NOT block (defer) but IS recorded with dryRun:true
  assert.equal(out.dryRunDeny, null)
  assert.equal(out.recordedAfterDryRun, 4) // deny + symlinkDeny + relativeExpanded + dryRun
  assert.equal(out.recordedDryRun.dryRun, true)
  assert.match(out.recordedDryRun.event.line, /would deny/)

  // INTERNAL-ERROR FAIL-SAFE: an internal error (member resolution OR fortress lookup)
  // DEFERS the whole call (null) — never blocks the host — and records nothing.
  assert.equal(out.memberResolveError, null) // /deny/x would deny, but /THROW resolution error → defer
  assert.equal(out.lookupError, null) // reason 'error:fail-safe' → defer
  assert.equal(out.recordedFinal, 4) // no new records from the error paths
})
