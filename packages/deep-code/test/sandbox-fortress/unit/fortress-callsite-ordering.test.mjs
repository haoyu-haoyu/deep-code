import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// ── F3 wiring coverage (MED audit gap): the per-call fortress decision must be consulted
// BEFORE the production permission code reaches ANY allow / auto-allow shortcut — otherwise
// a fortress DENY would be silently bypassed (the allow returns first and the hook never
// runs). The adapter decisions themselves are behaviorally unit-tested (file-tool-decision /
// process-exec-decision / bash-read-decision), but those run the adapter in ISOLATION and
// can't see where it sits in the real call-site.
//
// A behavioral test of the call-site is infeasible: checkReadPermissionForTool /
// checkWritePermissionForTool (filesystem.ts) and bashToolHasPermission (bashPermissions.ts)
// pull the entire permission + tool + tree-sitter chain (and the chalk/shell-quote hoist
// gotcha breaks a bun --eval import). So this is a SOURCE-ORDER guard: within each function
// body, the fortress hook must lexically precede EVERY allow shortcut that follows it — not
// just the last one. (An earlier reviewer caught that anchoring on a single late allow lets a
// hook move below an earlier allow and stay green; hence we pin the hook against the full set
// of known bypasses.) It fails loudly if the hook is moved below any allow, OR if the call-
// site is refactored so an anchor no longer matches — at which point the wiring must be re-
// verified and the anchor re-pinned (the failure messages say so).

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = rel => readFileSync(resolve(packageRoot, rel), 'utf8')

// Slice a function body from its start signature up to the next signature (or EOF). Bounding
// matters when an anchor isn't file-unique (e.g. a helper called in several flows).
function bodyOf(src, startSig, endSig) {
  const start = src.indexOf(startSig)
  assert.ok(start >= 0, `anchor not found: '${startSig}' — the function was renamed/removed; re-pin this guard`)
  const afterStart = start + startSig.length
  const end = endSig ? src.indexOf(endSig, afterStart) : -1
  return src.slice(start, end >= 0 ? end : src.length)
}

function at(body, label, anchor) {
  const i = body.indexOf(anchor)
  assert.ok(i >= 0, `${label}: anchor '${anchor}' not found — re-verify the wiring and re-pin this guard`)
  return i
}

// Assert `hook` appears before EVERY one of `allowAnchors` (each a downstream bypass). The
// hook preceding the EARLIEST bypass is the real invariant; checking them all makes the guard
// robust to the earliest one being renamed/removed and catches a hook moved below any of them.
function assertHookPrecedesAllAllows(body, label, hook, allowAnchors) {
  const h = at(body, `${label} (hook)`, hook)
  for (const allow of allowAnchors) {
    const a = at(body, `${label} (allow)`, allow)
    assert.ok(
      h < a,
      `${label}: the fortress hook must be consulted BEFORE the '${allow}' allow shortcut, else a fortress deny is bypassed (hook@${h} >= allow@${a})`,
    )
  }
}

// Find [openBrace, matchingCloseBrace] for the block opened by `openSig` (which must end in
// '{'). Brace-counting from the opening brace — these blocks contain no string/comment braces.
function blockRange(body, label, openSig) {
  const i = at(body, label, openSig)
  const open = i + openSig.length - 1 // index of the '{' that openSig ends with
  let depth = 0
  for (let k = open; k < body.length; k++) {
    if (body[k] === '{') depth++
    else if (body[k] === '}' && --depth === 0) return [open, k]
  }
  assert.fail(`${label}: unbalanced braces after '${openSig}' — re-pin this guard`)
}

test('filesystem.ts: the fortress fs-read hook precedes EVERY read allow shortcut', () => {
  const src = read('src/utils/permissions/filesystem.ts')
  // bound to checkReadPermissionForTool's body (pathInAllowedWorkingPath / editResult appear in
  // other flows file-wide, so scope to this function).
  const body = bodyOf(
    src,
    'export function checkReadPermissionForTool',
    'export function checkWritePermissionForTool',
  )
  // The EARLIEST bypass is the "edit access implies read" probe (returns allow if the path is
  // writable — would bypass a fortress READ deny); then the working-directory allow.
  assertHookPrecedesAllAllows(body, 'read', "checkFortressFileDecision('fs-read'", [
    'if (editResult.behavior === \'allow\')',
    'pathInAllowedWorkingPath(',
  ])
})

test('filesystem.ts: the fortress fs-write hook precedes EVERY write allow shortcut', () => {
  const src = read('src/utils/permissions/filesystem.ts')
  // BOUND to checkWritePermissionForTool's body (end at the next function) so an anchor like
  // checkEditableInternalPath( can ONLY match its CALLSITE inside this function, never the
  // helper's later DEFINITION — otherwise removing the real 1.5 callsite would silently fall
  // back to the definition and keep the guard green instead of failing loudly.
  const body = bodyOf(src, 'export function checkWritePermissionForTool', 'export function generateSuggestions(')
  // In order after the hook: 1.5 internal-editable (plan/scratchpad), 1.6 .deepcode/** session
  // allow, and the acceptEdits working-dir auto-allow. The hook must precede ALL of them.
  assertHookPrecedesAllAllows(body, 'write', "checkFortressFileDecision('fs-write'", [
    'checkEditableInternalPath(',
    'claudeFolderAllowRule',
    "mode === 'acceptEdits' && isInWorkingDir",
  ])
})

test('filesystem.ts: the fs-write hook is lexically WRAPPED by the !skipFortressCheck guard (Read implied-edit probe must not double-fire it)', () => {
  const src = read('src/utils/permissions/filesystem.ts')
  // BOUND to checkWritePermissionForTool's body (end at the next function) so the guard anchors
  // only on THIS function's wiring, never a same-named construct in a later helper.
  const body = bodyOf(src, 'export function checkWritePermissionForTool', 'export function generateSuggestions(')
  // The hook must sit INSIDE the `if (!skipFortressCheck) { ... }` block — a phantom fs-write
  // violation during a pure read would otherwise be recorded by the speculative implied-edit
  // probe (which passes skipFortressCheck=true). Proven by brace-matched containment, not mere
  // adjacency (a hook after the block's close brace would defeat adjacency-only checks).
  const [open, close] = blockRange(body, 'write/skip-guard', 'if (!skipFortressCheck) {')
  const hook = at(body, 'write/skip-guard (hook)', "checkFortressFileDecision('fs-write'")
  assert.ok(
    hook > open && hook < close,
    `write: the fs-write hook must be INSIDE the !skipFortressCheck block (hook@${hook} not in (${open},${close}))`,
  )
})

test('bashPermissions.ts: both fortress hooks (process-exec, read-floor) precede the sandbox auto-allow', () => {
  const src = read('src/tools/BashTool/bashPermissions.ts')
  // checkSandboxAutoAllow is DEFINED earlier in the file; scope to bashToolHasPermission so we
  // anchor on the CALL inside it, not the definition.
  // BOUND to bashToolHasPermission's body (end at the next function) so anchors match the
  // CALLS inside it, never a same-named call/definition in a later helper.
  const body = bodyOf(src, 'export async function bashToolHasPermission', 'export function isNormalizedGitCommand(')
  assertHookPrecedesAllAllows(body, 'bash/process-exec', 'checkFortressProcessExecDecision(', ['checkSandboxAutoAllow('])
  assertHookPrecedesAllAllows(body, 'bash/read-floor', 'checkFortressBashReadDecision(', ['checkSandboxAutoAllow('])
})

test('bashPermissions.ts: the process-exec gate precedes the paranoid read floor (documented relative order)', () => {
  const src = read('src/tools/BashTool/bashPermissions.ts')
  // BOUND to bashToolHasPermission's body (end at the next function) so anchors match the
  // CALLS inside it, never a same-named call/definition in a later helper.
  const body = bodyOf(src, 'export async function bashToolHasPermission', 'export function isNormalizedGitCommand(')
  assertHookPrecedesAllAllows(body, 'bash/exec-before-read', 'checkFortressProcessExecDecision(', [
    'checkFortressBashReadDecision(',
  ])
})
