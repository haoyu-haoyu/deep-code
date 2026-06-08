import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 REDTEAM (file-tool arm): end-to-end fortress enforcement for the Read/Edit/Write
// tools. The sibling floors.redteam covers the Bash adapters; this covers
// checkFortressFileDecision — the FAITHFUL path that knows the concrete absolute target and
// applies the real glob/path matcher with NO OS translation. It enforces what the Bash
// OS-pattern path (PR-D) deliberately deferred: fs-read denies (macOS allowRead would win
// over denyRead), CASE-FOLDED denies (the OS matcher is case-sensitive), and NON-PROJECTABLE
// GLOB fs-write denies (the OS path drops globs). Every other file-tool test stubs
// resolveFortressDecision with a hand-keyed map; this wires the REAL createFortressManagerState
// (matcher + effort default + directive) behind the adapter so the full decision chain runs
// against adversarial inputs. (Rules are seeded via setRuleset — the real manager STATE, not
// the config LOADER; the loader's '~'/relative→absolute normalization is covered separately
// by manager-wiring.test.mjs, so every pattern here is already in its absolute matched form.)
//
// KEY DIFFERENCE from the Bash read floor: the file-tool enforces a MATCHED rule at ANY
// effort (effort only sets the NO-MATCH default). So the negative control isn't "all defer
// below max" — it's "a matched deny still denies at effort 'off', but the un-ruled paranoid
// floor lifts" — which distinguishes matched enforcement from the paranoid posture.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/fileToolDecision.ts',
  'src/sandbox-fortress/rule-engine/fortressPermission.mjs',
  'src/sandbox-fortress/rule-engine/managerState.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
  'src/sandbox-fortress/networkDecision.mjs',
  'src/sandbox-fortress/observability/violationLog.mjs',
]

// expandPath: absolute paths pass through; the matcher sees the concrete target verbatim.
const PATH_STUB = `export const expandPath = (p) => {
  if (typeof p !== 'string') throw new TypeError('not a string')
  if (p.startsWith('/')) return p
  return '/work/proj/' + p
}
`

// The REAL managerState behind the SandboxManager surface fileToolDecision calls. Effort 'max'
// (paranoid no-match deny) + matched fs-read/fs-write deny/ask rules (including the shapes the
// OS path CANNOT do: a case-mismatched deny, and an absolute-glob fs-write deny) + workspace
// allow carve-outs. Patterns are absolute (the matcher is anchored segment-by-segment — a raw
// relative pattern would match nothing, which is why the loader normalizes them to absolute).
const ADAPTER_STUB = `
import { createFortressManagerState } from '../../sandbox-fortress/rule-engine/managerState.mjs'
const state = createFortressManagerState()
state.setEffortLevel('max')
state.setRuleset('user', [
  { layer: 'user', resource: 'fs-read', pattern: '/vault/master.key', action: 'deny' },   // concrete fs-read deny (OS allowRead would win on macOS)
  { layer: 'user', resource: 'fs-read', pattern: '/vault/SECRET.key', action: 'deny' },    // CASE-MISMATCHED deny (folds to match /vault/secret.key — the OS matcher is case-sensitive)
  { layer: 'user', resource: 'fs-write', pattern: '/home/*/.ssh/**', action: 'deny' },      // absolute-GLOB fs-write deny (non-projectable → OS path drops globs)
  { layer: 'user', resource: 'fs-read', pattern: '/opt/config/**', action: 'ask' },         // ask rule → prompt
  { layer: 'user', resource: 'fs-read', pattern: '/work/proj/**', action: 'allow' },        // workspace read carve-out
  { layer: 'user', resource: 'fs-write', pattern: '/work/proj/**', action: 'allow' },       // workspace write carve-out
])
export const SandboxManager = {
  getDefaultDecision: () => state.getDefaultDecision(),
  resolveFortressDecision: (resource, target) => state.resolveDecision({ resource, target }),
  isDryRunMode: () => state.isDryRunMode(),
  recordFortressViolation: (r) => state.recordFortressViolation(r),
}
export const __setEffort = (e) => state.setEffortLevel(e) // negative-control toggle
export const __setDryRun = (v) => state.enableDryRunMode(v)
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-filetool-redteam-'))
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
    import { __setEffort, __setDryRun } from ${JSON.stringify(adapterPath)}
    const F = (resource, paths, tool) => checkFortressFileDecision(resource, paths, tool || 'Read')
    const b = (d) => (d == null ? 'defer' : d.behavior)
    const out = {
      // ── effort 'max', the FAITHFUL path ──
      readMatchedDeny: b(F('fs-read', '/vault/master.key')),                 // concrete fs-read deny → DENY (OS would allow-win)
      readCaseFoldDeny: b(F('fs-read', '/vault/secret.key')),                // /vault/secret.key vs deny /vault/SECRET.key → DENY (case-folded; a case-sensitive OS matcher MISSES this)
      writeGlobDeny: b(F('fs-write', '/home/me/.ssh/authorized_keys', 'Write')), // absolute-glob fs-write deny → DENY (non-projectable)
      readAsk: b(F('fs-read', '/opt/config/app.conf')),                      // ask rule → ASK
      symlinkSetDeny: b(F('fs-read', ['/work/proj/clean.txt', '/vault/master.key'])), // deny-first across the resolved set → DENY
      allowedWorkspaceRead: b(F('fs-read', '/work/proj/src/a.ts')),          // allow rule → defer (host decides)
      unruledReadParanoid: b(F('fs-read', '/tmp/random.txt')),               // un-ruled at max → paranoid no-match → DENY
      unruledWriteParanoid: b(F('fs-write', '/tmp/random.txt', 'Edit')),     // un-ruled write at max → paranoid no-match → DENY
    }
    // DRY-RUN: a would-be deny must NOT block (defer), preserving behavior while it logs.
    __setDryRun(true)
    out.dryRunMatchedDeny = b(F('fs-read', '/vault/master.key'))            // matched deny, dry-run → DEFER (log-only)
    __setDryRun(false)
    // NEGATIVE CONTROL: drop effort to 'off'. The file-tool enforces MATCHED rules at ANY
    // effort, so a matched deny (incl. the CASE-FOLDED one) STILL denies — but the un-ruled
    // PARANOID floor lifts (no-match becomes defer). This distinguishes matched enforcement
    // (always on) from the paranoid posture (effort-gated), AND — for the case-fold case —
    // proves the deny comes from the FOLDED RULE, not the floor (which is gone at 'off').
    __setEffort('off')
    out.offReadMatchedDeny = b(F('fs-read', '/vault/master.key'))           // matched → STILL DENY
    out.offCaseFoldDeny = b(F('fs-read', '/vault/secret.key'))              // case-folded matched deny → STILL DENY (NOT the floor)
    out.offWriteGlobDeny = b(F('fs-write', '/home/me/.ssh/authorized_keys', 'Write')) // matched → STILL DENY
    out.offUnruledRead = b(F('fs-read', '/tmp/random.txt'))                 // un-ruled → floor lifted → defer
    out.offAllowedWorkspace = b(F('fs-read', '/work/proj/src/a.ts'))        // allow → defer (same as max)
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('REDTEAM: F3 file-tool enforcement (the faithful path) end-to-end through the real manager STATE', () => {
  const out = runProbe()

  // The faithful path enforces what the OS pattern path cannot: a concrete fs-read deny
  // (macOS allowRead would win), a CASE-MISMATCHED deny (the OS matcher is case-sensitive),
  // and a NON-PROJECTABLE absolute-glob fs-write deny (the OS path drops globs).
  assert.equal(out.readMatchedDeny, 'deny', 'a concrete fs-read deny is enforced (the OS path could not)')
  assert.equal(out.readCaseFoldDeny, 'deny', 'a case-mismatched fs-read deny is folded + enforced (a case-sensitive OS matcher misses it)')
  assert.equal(out.writeGlobDeny, 'deny', 'an absolute-glob fs-write deny is enforced (non-projectable to the OS)')
  assert.equal(out.readAsk, 'ask', 'a matched ask rule prompts')
  assert.equal(out.symlinkSetDeny, 'deny', 'deny-first across the resolved set: a denied member blocks even with a clean alias')
  assert.equal(out.allowedWorkspaceRead, 'defer', 'a matched allow carve-out defers to the host (read proceeds)')

  // At effort 'max' an un-ruled read/write hits the paranoid no-match floor (deny-by-default).
  assert.equal(out.unruledReadParanoid, 'deny', 'an un-ruled read is floored at effort max (paranoid deny-by-default)')
  assert.equal(out.unruledWriteParanoid, 'deny', 'an un-ruled write is floored at effort max (paranoid deny-by-default)')

  // DRY-RUN preserves behavior: a would-be deny defers (logs, does not block).
  assert.equal(out.dryRunMatchedDeny, 'defer', 'a matched deny in dry-run defers (log-only, no block)')

  // NEGATIVE CONTROL: matched rules are effort-INDEPENDENT — a matched deny (incl. the folded
  // one) denies at 'off' too — while the paranoid no-match floor is effort-gated and lifts.
  assert.equal(out.offReadMatchedDeny, 'deny', 'a matched fs-read deny enforces at ANY effort (not just paranoid)')
  assert.equal(out.offCaseFoldDeny, 'deny', 'the case-folded deny fires from the RULE (floor is gone at off), not the paranoid posture')
  assert.equal(out.offWriteGlobDeny, 'deny', 'a matched fs-write deny enforces at ANY effort')
  assert.equal(out.offUnruledRead, 'defer', 'below max the paranoid no-match floor lifts (un-ruled reads defer)')
  assert.equal(out.offAllowedWorkspace, 'defer', 'an allow carve-out defers regardless of effort')
})
