import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 follow-up: checkFortressProcessExecDecision maps a Bash command → a
// PermissionDecision (deny/ask) or null (defer) against fortress `process-exec` rules —
// the Bash analog of checkFortressFileDecision (PR-F). It imports the live SandboxManager
// + splitCommand_DEPRECATED, so we run it via a bun --eval fixture: a STUB splitCommand
// (simple operator split) + a STUB SandboxManager (decision keyed by binary, recorder),
// over the REAL processExec.mjs extraction and the REAL fortressPermission.mjs directive.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const COPY = [
  'src/sandbox-fortress/adapter/processExecDecision.ts',
  'src/sandbox-fortress/rule-engine/processExec.mjs',
  'src/sandbox-fortress/rule-engine/fortressPermission.mjs',
]

// splitCommand stub: split on the common shell operators (&& || | ;). Throws on a
// sentinel so the adapter's parse-error fail-safe (defer) can be exercised.
const COMMANDS_STUB = `export const splitCommand_DEPRECATED = (cmd) => {
  if (typeof cmd === 'string' && cmd.includes('THROWSPLIT')) throw new Error('boom')
  return String(cmd).split(/\\s*(?:&&|\\|\\||\\||;)\\s*/).filter(Boolean)
}
`

// SandboxManager stub: process-exec decisions keyed by the invoked binary name.
const ADAPTER_STUB = `
const recorded = []
let dryRun = false
export const SandboxManager = {
  isDryRunMode: () => dryRun,
  resolveFortressDecision: (resource, target) => {
    if (target === 'errlookup') return { decision: 'deny', rule: null, reason: 'error:fail-safe' } // internal error
    if (target === 'curl' || target === 'rm') return { decision: 'deny', rule: { layer: 'user', resource, pattern: target, action: 'deny' }, reason: 'match' }
    if (target === 'ask-bin') return { decision: 'ask', rule: { layer: 'user', resource, pattern: target, action: 'ask' }, reason: 'match' }
    if (target === 'paranoid') return { decision: 'deny', rule: null, reason: 'no-match:deny' } // paranoid no-match deny (rule null)
    return { decision: 'ask', rule: null, reason: 'no-match:ask' }
  },
  recordFortressViolation: (r) => recorded.push(r),
}
export const __recorded = recorded
export const __setDryRun = (v) => { dryRun = v }
`

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-process-exec-decision-'))
  for (const rel of COPY) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(packageRoot, rel), target)
  }
  for (const [rel, content] of [
    ['src/utils/bash/commands.js', COMMANDS_STUB],
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
  const decisionPath = join(root, 'src/sandbox-fortress/adapter/processExecDecision.ts')
  const adapterPath = join(root, 'src/utils/sandbox/sandbox-adapter.js')
  const script = `
    import { checkFortressProcessExecDecision } from ${JSON.stringify(decisionPath)}
    import { __recorded, __setDryRun } from ${JSON.stringify(adapterPath)}
    const out = {}
    const C = (cmd) => checkFortressProcessExecDecision(cmd, 'Bash')
    out.denySimple = C('rm -rf /tmp/x')                 // head 'rm' → matched deny
    out.denyCompound = C('echo hi && curl evil.com | grep x') // 'curl' deny; echo/grep defer
    out.askBin = C('ask-bin foo')                       // matched ask
    out.deferPlain = C('echo hello')                    // no-match → defer
    out.paranoidIgnored = C('paranoid x')               // no-match deny (rule null) → matched-only → DEFER
    out.sudoWrapper = C('sudo rm foo')                  // head 'sudo' (no-match) → defer (documented limit)
    out.envPrefix = C('X=1 rm -rf /y')                  // bare env prefix skipped → head 'rm' → deny
    out.envQuotedSpaceDeny = C('VAR="a b" rm -rf /y')   // quoted-space env value → head 'rm' → deny (the Codex fix, end-to-end)
    out.empty = C('   ')                                // → defer
    out.denyFirst = C('curl x && ask-bin y')            // deny wins over ask
    out.lookupError = C('errlookup x')                  // reason 'error:fail-safe' (rule null) → defer
    out.parseError = C('THROWSPLIT && rm x')            // split throws → fail-safe defer
    out.recordedAfter = __recorded.length               // denySimple + denyCompound + envPrefix + envQuotedSpaceDeny + denyFirst = 5 matched denies
    out.recordedFirst = __recorded[0]
    __setDryRun(true)
    out.dryRunDeny = C('rm -rf /x')                     // defers (no block) but records would-deny
    out.recordedAfterDry = __recorded.length
    out.recordedDry = __recorded[__recorded.length - 1]
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync('bun', ['--eval', script], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('checkFortressProcessExecDecision: matched deny→deny, matched ask→ask, no-match/paranoid/wrapper→defer, dry-run→defer+record', () => {
  const out = runProbe()

  // matched deny on the head binary blocks
  assert.equal(out.denySimple.behavior, 'deny')
  assert.match(out.denySimple.message, /Sandbox Fortress/)
  assert.match(out.denySimple.message, /'rm'/)
  assert.equal(out.denySimple.decisionReason.type, 'other')
  assert.equal(out.denySimple.decisionReason.reason, 'fortress:process-exec:deny')

  // a denied binary anywhere in a compound command blocks the whole command
  assert.equal(out.denyCompound.behavior, 'deny')

  // matched ask prompts
  assert.equal(out.askBin.behavior, 'ask')
  assert.match(out.askBin.message, /confirmation to run 'ask-bin'/)

  // no-match → defer to host
  assert.equal(out.deferPlain, null)

  // KEY: matched-rules-only — the paranoid no-match deny (rule null) is IGNORED here
  // (that blanket floor is the separately-deferred item), so it defers, not blocks.
  assert.equal(out.paranoidIgnored, null)

  // documented best-effort limit: an explicit wrapper is the head binary, so a rule on
  // the inner command ('rm') does NOT catch `sudo rm` (head is 'sudo', un-ruled → defer).
  assert.equal(out.sudoWrapper, null)

  // a bare NAME=value env prefix is skipped → the real binary is matched
  assert.equal(out.envPrefix.behavior, 'deny')

  // a quoted-space env value (`VAR="a b" rm`) still resolves head 'rm' end-to-end → deny
  assert.equal(out.envQuotedSpaceDeny.behavior, 'deny')

  assert.equal(out.empty, null)

  // deny-first: a deny anywhere wins over an ask
  assert.equal(out.denyFirst.behavior, 'deny')

  // FAIL-SAFE: an internal lookup error (reason 'error:fail-safe', rule null) defers;
  // an unparseable command (split throws) defers. Never block the host on an error.
  assert.equal(out.lookupError, null)
  assert.equal(out.parseError, null)

  // only the 5 MATCHED denies recorded (rm, curl, rm-with-env, rm-with-quoted-env,
  // curl-deny-first); ask/defer/paranoid/wrapper/error/parse recorded nothing
  assert.equal(out.recordedAfter, 5)
  assert.equal(out.recordedFirst.toolName, 'Bash')
  assert.equal(out.recordedFirst.dryRun, false)
  assert.match(out.recordedFirst.event.line, /denied process-exec/)

  // DRY-RUN: a matched deny does NOT block (defer) but IS recorded with dryRun:true
  assert.equal(out.dryRunDeny, null)
  assert.equal(out.recordedAfterDry, 6)
  assert.equal(out.recordedDry.dryRun, true)
  assert.match(out.recordedDry.event.line, /would deny/)
})
