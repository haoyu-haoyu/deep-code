import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 paranoid fs-read floor: checkFortressBashReadDecision maps a Bash command → a
// PermissionDecision (deny/ask) or null (defer), gated on the paranoid posture. It imports
// the live SandboxManager + expandPath + getCwd + getPathsForPermissionCheck + splitCommand,
// so we run it via a bun --eval fixture with those STUBBED, over the REAL bashReadPaths/
// shellTokenize/fortressPermission/systemReadAllowlist cores.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/bashReadDecision.ts',
  'src/sandbox-fortress/rule-engine/bashReadPaths.mjs',
  'src/sandbox-fortress/rule-engine/shellTokenize.mjs',
  'src/sandbox-fortress/rule-engine/fortressPermission.mjs',
  'src/sandbox-fortress/rule-engine/systemReadAllowlist.mjs',
]

const COMMANDS_STUB = `export const splitCommand_DEPRECATED = (cmd) => {
  if (typeof cmd === 'string' && cmd.includes('THROWSPLIT')) throw new Error('boom')
  return String(cmd).split(/\\s*(?:&&|\\|\\||\\||;)\\s*/).filter(Boolean)
}
`

// getCwd stub: the LIVE shell cwd, togglable to simulate a `cd`.
const CWD_STUB = `let live = '/work/proj'
export const getCwd = () => live
export const __setCwd = (v) => { live = v }
`

// expandPath stub: mirror the real one — expand '~' and '~/', resolve relative (incl.
// '~user', which the real expandPath does NOT special-case) against the base cwd.
const PATH_STUB = `export const expandPath = (p, base) => {
  if (typeof p !== 'string') throw new TypeError('not a string')
  if (p === '~') return '/home/me'
  if (p.startsWith('~/')) return '/home/me/' + p.slice(2)
  if (p.startsWith('/')) return p
  return (base || '/work/proj') + '/' + p
}
`

// getPathsForPermissionCheck stub: identity, except two PRE-EXISTING symlinks resolve to
// their real targets (so the symlink-resolution path is exercised).
const FSOPS_STUB = `export const getPathsForPermissionCheck = (p) => {
  if (p === '/work/proj/creds-link') return [p, '/home/me/.aws/credentials']
  if (p === '/work/proj/shadow-link') return [p, '/etc/userdeny-shadow']
  // a file under a SYMLINKED workspace dir (~/work -> /Volumes/SSD/work): the read resolves
  // to a realpath form outside the lexical workspace — must still be exempt (the fix).
  if (p === '/work/proj/sym-file') return [p, '/Volumes/SSD/work/sym-file']
  return [p]
}
`

// SandboxManager stub: paranoid posture togglable; fs-read decisions keyed by the target.
const ADAPTER_STUB = `
const recorded = []
let dryRun = false
let def = 'deny' // the no-match default decision ('deny' = paranoid/effort max)
export const SandboxManager = {
  getDefaultDecision: () => def,
  isDryRunMode: () => dryRun,
  resolveFortressDecision: (resource, target) => {
    if (target.includes('/errlookup')) return { decision: 'deny', rule: null, reason: 'error:fail-safe' }
    if (target.includes('/userdeny')) return { decision: 'deny', rule: { layer: 'user', resource, pattern: target, action: 'deny' }, reason: 'match' }
    if (target.includes('/userask')) return { decision: 'ask', rule: { layer: 'user', resource, pattern: target, action: 'ask' }, reason: 'match' }
    return { decision: def, rule: null, reason: 'no-match' } // un-ruled → the effort default
  },
  recordFortressViolation: (r) => recorded.push(r),
}
export const __recorded = recorded
export const __setDryRun = (v) => { dryRun = v }
export const __setDefault = (v) => { def = v }
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-bash-read-decision-'))
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
  const decisionPath = join(root, 'src/sandbox-fortress/adapter/bashReadDecision.ts')
  const adapterPath = join(root, 'src/utils/sandbox/sandbox-adapter.js')
  const cwdPath = join(root, 'src/utils/cwd.js')
  const script = `
    import { checkFortressBashReadDecision } from ${JSON.stringify(decisionPath)}
    import { __recorded, __setDryRun, __setDefault } from ${JSON.stringify(adapterPath)}
    import { __setCwd } from ${JSON.stringify(cwdPath)}
    const out = {}
    const WS = ['/work/proj']
    // the 3rd arg is a thunk returning the (symlink-resolved) workspace dirs
    const C = (cmd, dirs) => checkFortressBashReadDecision(cmd, 'Bash', () => dirs || WS)
    // ── PARANOID (default 'deny'), live cwd /work/proj ──
    out.homeSecret = C('cat ~/.aws/credentials')         // not allowlisted → paranoid no-match deny → DENY
    out.systemPath = C('cat /etc/passwd')                // /etc allowlisted → exempt → null
    out.workspacePath = C('cat /work/proj/src/a.ts')     // workspace → exempt → null
    out.matchedDenyOnSystem = C('cat /etc/userdeny')     // MATCHED user deny on a system path → enforced → DENY
    out.userAsk = C('cat ~/userask/x')                   // matched ask rule → ASK
    out.nonReader = C('echo ~/.aws/credentials')         // echo not a reader → null
    out.lookupError = C('cat ~/errlookup/x')             // reason 'error:fail-safe' → skip → null
    out.parseError = C('THROWSPLIT && cat ~/.aws/x')     // split throws → fail-safe → null
    out.legitRelative = C('cat src/a.ts')                // relative under live cwd /work/proj → workspace → null
    out.symlinkToHome = C('cat /work/proj/creds-link')   // pre-existing symlink → /home/me/.aws/credentials → DENY
    out.symlinkMatchedDeny = C('cat /work/proj/shadow-link') // symlink → /etc/userdeny-shadow (matched deny) → DENY
    out.tildeUser = C('cat ~alice/.ssh/id_rsa')          // ~user/ home path not allowlistable → DENY
    out.bareTildeUser = C('tree ~root')                  // bare ~root (bash expands it) → not allowlistable → DENY
    out.tildeLiteralOverblock = C('cat ~note.txt')       // ANY ~X is floored — a safe over-block of a literal ~file, never a fail-open → DENY
    out.bareTilde = C('cat ~')                           // plain '~' is NOT tildeUser → expandPath resolves it to the real home → floored as a non-workspace read → DENY
    out.additionalDir = C('cat /extra/file.txt', ['/work/proj', '/extra']) // additional working dir → exempt → null
    // symlinked workspace (~/work -> /Volumes/SSD/work): read resolves to the realpath form,
    // exempt because the RESOLVED workspace dirs are passed (the symlinked-workspace fix).
    out.symlinkedWorkspace = C('cat /work/proj/sym-file', ['/work/proj', '/Volumes/SSD/work'])
    out.recordedAfterParanoid = __recorded.length        // matchedDenyOnSystem + symlinkMatchedDeny = 2 (no-match floor not logged)
    // ── LIVE CWD after a 'cd ~' (the cwd-base fix): relative read resolves against the live cwd ──
    __setCwd('/home/me')
    out.afterCdHomeRelative = C('cat .aws/credentials')  // /home/me/.aws/credentials → not workspace/system → DENY (was a bypass)
    __setCwd('/work/proj')
    // ── BELOW MAX (default 'ask') → fully inert ──
    __setDefault('ask')
    out.belowMax = C('cat ~/.aws/credentials')           // not paranoid → null
    out.belowMaxUserDeny = C('cat /etc/userdeny')        // not paranoid → null (matched deny NOT enforced below max)
    // ── DRY-RUN at paranoid ──
    __setDefault('deny'); __setDryRun(true)
    out.dryRunMatchedDeny = C('cat /etc/userdeny')       // matched deny dry-run → defer (null) but record would-deny
    out.recordedAfterDry = __recorded.length
    out.recordedLast = __recorded[__recorded.length - 1]
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('checkFortressBashReadDecision: paranoid floor (live-cwd, symlink-resolved, ~user-denied), matched-deny enforced, inert below max', () => {
  const out = runProbe()

  // an un-ruled home/secret read is denied by the paranoid floor
  assert.equal(out.homeSecret.behavior, 'deny')
  assert.match(out.homeSecret.message, /Sandbox Fortress/)
  assert.match(out.homeSecret.message, /credentials/)
  assert.equal(out.homeSecret.decisionReason.reason, 'fortress:fs-read:deny')

  // system + workspace (incl. live-cwd-relative) reads are exempt → defer (null)
  assert.equal(out.systemPath, null)
  assert.equal(out.workspacePath, null)
  assert.equal(out.legitRelative, null)
  assert.equal(out.additionalDir, null) // additional working dir exempt

  // matched deny enforced even on an allowlisted system path
  assert.equal(out.matchedDenyOnSystem.behavior, 'deny')

  // matched ask prompts
  assert.equal(out.userAsk.behavior, 'ask')
  assert.match(out.userAsk.message, /confirmation to read/)

  // non-reader + fail-safe (lookup error, unparseable) all defer
  assert.equal(out.nonReader, null)
  assert.equal(out.lookupError, null)
  assert.equal(out.parseError, null)

  // SYMLINK resolution: a pre-existing symlink to a floored path / a matched-deny path is caught
  assert.equal(out.symlinkToHome.behavior, 'deny')
  assert.equal(out.symlinkMatchedDeny.behavior, 'deny')

  // every `~X` token is un-allowlistable → denied (bash expands `~user`/`~user/…` and we
  // do NOT second-guess the login name, so this never fail-opens on an exotic username).
  assert.equal(out.tildeUser.behavior, 'deny')
  assert.equal(out.bareTildeUser.behavior, 'deny')
  assert.equal(out.tildeLiteralOverblock.behavior, 'deny') // a literal ~file is a SAFE over-block, never a fail-open
  assert.equal(out.bareTilde.behavior, 'deny') // plain '~' resolves to the real home and floors as a non-workspace read
  // symlinked-workspace read is exempt when the RESOLVED workspace dirs are supplied
  assert.equal(out.symlinkedWorkspace, null)

  // CWD-BASE FIX: after a `cd ~`, a relative read resolves against the LIVE cwd → DENY
  // (with the old getOriginalCwd it would have resolved under the workspace and leaked)
  assert.equal(out.afterCdHomeRelative.behavior, 'deny')

  // only MATCHED denies recorded (matchedDenyOnSystem + symlinkMatchedDeny); no-match floor not logged
  assert.equal(out.recordedAfterParanoid, 2)

  // GATED ON PARANOID: below effort 'max' fully inert — even a matched deny defers
  assert.equal(out.belowMax, null)
  assert.equal(out.belowMaxUserDeny, null)

  // DRY-RUN: a matched deny does NOT block (defer) but IS recorded with dryRun:true
  assert.equal(out.dryRunMatchedDeny, null)
  assert.equal(out.recordedAfterDry, 3)
  assert.equal(out.recordedLast.dryRun, true)
  assert.match(out.recordedLast.event.line, /would deny/)
})
