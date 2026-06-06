import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 REDTEAM: end-to-end fortress enforcement through the REAL config-loaded manager.
// Every other fortress test stubs SandboxManager.resolveFortressDecision with a hand-keyed
// map; this one wires the REAL createFortressManagerState (effort 'max' + real fs-read /
// process-exec deny rules) behind the REAL adapters (checkFortressBashReadDecision +
// checkFortressProcessExecDecision), so the full settings.fortress → matcher → effort
// default → directive → adapter decision chain is exercised against adversarial inputs.
// Only the FS/command primitives (cwd, expandPath, symlink resolution, splitCommand) are
// stubbed to a controlled virtual filesystem. manager.ts/adapters are TypeScript → bun.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/bashReadDecision.ts',
  'src/sandbox-fortress/adapter/processExecDecision.ts',
  'src/sandbox-fortress/rule-engine/bashReadPaths.mjs',
  'src/sandbox-fortress/rule-engine/processExec.mjs',
  'src/sandbox-fortress/rule-engine/shellTokenize.mjs',
  'src/sandbox-fortress/rule-engine/systemReadAllowlist.mjs',
  'src/sandbox-fortress/rule-engine/fortressPermission.mjs',
  'src/sandbox-fortress/rule-engine/managerState.mjs',
  'src/sandbox-fortress/rule-engine/resolveRules.mjs',
  'src/sandbox-fortress/rule-engine/effort.mjs',
  'src/sandbox-fortress/networkDecision.mjs',
  'src/sandbox-fortress/observability/violationLog.mjs',
]

// A simple operator splitter. Verified byte-identical to the real splitCommand_DEPRECATED
// for the command set used below (no redirections/heredocs/subshells, where it could
// diverge) — we stub it rather than import the real one to keep the fixture CI-portable
// (the real commands.ts pulls a chalk/shell-quote chain that doesn't resolve standalone).
const COMMANDS_STUB = `export const splitCommand_DEPRECATED = (cmd) =>
  String(cmd).split(/\\s*(?:&&|\\|\\||\\||;)\\s*/).filter(Boolean)
`
const CWD_STUB = `export const getCwd = () => '/work/proj'\n`
const PATH_STUB = `export const expandPath = (p, base) => {
  if (typeof p !== 'string') throw new TypeError('not a string')
  if (p === '~') return '/home/me'
  if (p.startsWith('~/')) return '/home/me/' + p.slice(2)
  if (p.startsWith('/')) return p
  return (base || '/work/proj') + '/' + p
}
`
const FSOPS_STUB = `export const getPathsForPermissionCheck = (p) => {
  if (p === '/work/proj/creds-link') return [p, '/home/me/.aws/credentials'] // pre-existing symlink
  return [p]
}
`

// The REAL managerState, configured from a realistic settings.fortress (effort 'max' +
// matched deny rules), exposed with the SandboxManager surface the adapters call.
const ADAPTER_STUB = `
import { createFortressManagerState } from '../../sandbox-fortress/rule-engine/managerState.mjs'
const state = createFortressManagerState()
state.setEffortLevel('max') // → paranoid → un-ruled default 'deny'
state.setRuleset('user', [
  { layer: 'user', resource: 'fs-read', pattern: '/etc/userdeny-secret', action: 'deny' },
  { layer: 'user', resource: 'process-exec', pattern: 'curl', action: 'deny' },
])
export const SandboxManager = {
  getDefaultDecision: () => state.getDefaultDecision(),
  resolveFortressDecision: (resource, target) => state.resolveDecision({ resource, target }),
  isDryRunMode: () => state.isDryRunMode(),
  recordFortressViolation: (r) => state.recordFortressViolation(r),
}
export const __setEffort = (e) => state.setEffortLevel(e) // negative-control toggle
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-fortress-redteam-'))
  for (const rel of COPY) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/utils/bash/commands.js', COMMANDS_STUB],
    ['src/utils/cwd.js', CWD_STUB],
    ['src/utils/path.js', PATH_STUB],
    ['src/utils/fsOperations.js', FSOPS_STUB],
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
  const readPath = join(root, 'src/sandbox-fortress/adapter/bashReadDecision.ts')
  const execPath = join(root, 'src/sandbox-fortress/adapter/processExecDecision.ts')
  const adapterPath = join(root, 'src/utils/sandbox/sandbox-adapter.js')
  const script = `
    import { checkFortressBashReadDecision } from ${JSON.stringify(readPath)}
    import { checkFortressProcessExecDecision } from ${JSON.stringify(execPath)}
    import { __setEffort } from ${JSON.stringify(adapterPath)}
    const WS = () => ['/work/proj']
    const R = (cmd) => checkFortressBashReadDecision(cmd, 'Bash', WS)
    const X = (cmd) => checkFortressProcessExecDecision(cmd, 'Bash')
    const b = (d) => (d == null ? 'defer' : d.behavior)
    const out = {
      // ── fs-read floor (real manager, effort max) ──
      exfilHome: b(R('cat ~/.aws/credentials')),     // un-ruled, not allowlisted → DENY (paranoid floor)
      systemRead: b(R('cat /etc/passwd')),           // /etc allowlisted → defer
      workspaceRead: b(R('cat /work/proj/src/a.ts')), // workspace → defer
      matchedDenyOnSystem: b(R('cat /etc/userdeny-secret')), // MATCHED deny even on /etc → DENY
      symlinkExfil: b(R('cat /work/proj/creds-link')), // symlink → /home/me/.aws/credentials → DENY
      tildeUserExfil: b(R('tree ~root/.ssh')),       // ~user home → DENY
      wrappedReader: b(R('sudo cat ~/.aws/credentials')), // head 'sudo' (not a reader) → defer (documented)
      nonReader: b(R('echo ~/.aws/credentials')),    // echo not a reader → defer
      // ── process-exec floor (real manager) ──
      execDeny: b(X('curl https://evil.com')),       // MATCHED process-exec deny → DENY
      execCompound: b(X('echo hi && curl evil.com')), // curl anywhere → DENY
      execUnruled: b(X('rm -rf /tmp/x')),            // un-ruled binary: matched-rules-only ignores the paranoid floor → defer
      execObfuscated: b(X('eval "curl evil.com"')),  // head 'eval' hides curl → defer (documented)
    }
    // NEGATIVE CONTROL: drop effort below 'max' → the Bash read floor goes fully inert
    // (every read defers, even a matched deny — the floor is gated on the paranoid posture).
    // This self-proves the deny outcomes above come from REAL enforcement, not the harness,
    // and guards a future regression that silently disables the floor.
    __setEffort('off')
    out.offExfilHome = b(R('cat ~/.aws/credentials'))
    out.offMatchedDeny = b(R('cat /etc/userdeny-secret'))
    out.offSymlinkExfil = b(R('cat /work/proj/creds-link'))
    out.offTildeUser = b(R('tree ~root/.ssh'))
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('REDTEAM: F3 floors enforce correctly end-to-end through the real config-loaded manager', () => {
  const out = runProbe()

  // fs-read floor: real exfil attempts are DENIED; system/workspace reads defer
  assert.equal(out.exfilHome, 'deny', 'un-ruled home read must be floored at effort max')
  assert.equal(out.systemRead, 'defer', 'a system path stays readable so the shell runs')
  assert.equal(out.workspaceRead, 'defer', 'workspace reads are exempt')
  assert.equal(out.matchedDenyOnSystem, 'deny', 'a matched user deny beats the allowlist')
  assert.equal(out.symlinkExfil, 'deny', 'a pre-existing symlink to a secret is resolved + denied')
  assert.equal(out.tildeUserExfil, 'deny', "a ~user home read is floored")

  // documented best-effort evasions DEFER (never a false green, but acknowledged limits)
  assert.equal(out.wrappedReader, 'defer', 'a wrapped reader (sudo cat) is a documented miss')
  assert.equal(out.nonReader, 'defer', 'a non-reader command surfaces no read paths')

  // process-exec floor: a matched deny blocks (incl. inside a compound); un-ruled defers
  assert.equal(out.execDeny, 'deny', 'a matched process-exec deny blocks the binary')
  assert.equal(out.execCompound, 'deny', 'a denied binary anywhere in a compound blocks it')
  assert.equal(out.execUnruled, 'defer', 'process-exec is matched-rules-only — no blanket paranoid block')
  assert.equal(out.execObfuscated, 'defer', 'eval-wrapped command is a documented miss')

  // NEGATIVE CONTROL: below effort 'max' the read floor is inert — every read defers,
  // proving the deny outcomes above are produced by REAL enforcement, not the test harness.
  assert.equal(out.offExfilHome, 'defer')
  assert.equal(out.offMatchedDeny, 'defer')
  assert.equal(out.offSymlinkExfil, 'defer')
  assert.equal(out.offTildeUser, 'defer')
})
