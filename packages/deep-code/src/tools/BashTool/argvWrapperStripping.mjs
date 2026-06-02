// Argv-level safe-wrapper stripping (timeout, nice, stdbuf, env, time, nohup),
// extracted from pathValidation.ts so it is unit-testable under `node --test`
// (the .ts pulls in shell-quote / tree-sitter deps that node can't load).
//
// This is the CANONICAL argv wrapper stripper: it decides the BASE COMMAND that
// PATH validation sees (validateSinglePathCommandArgv). A stripping gap = a path
// command whose out-of-project paths are never validated. Pure (regex + argv
// array logic); pathValidation.ts imports stripWrappersFromArgv back.

// Argv-level safe-wrapper stripping (timeout, nice, stdbuf, env, time, nohup)
//
// This is the CANONICAL stripWrappersFromArgv. bashPermissions.ts still
// exports an older narrower copy (timeout/nice-n-N only) that is DEAD CODE
// — no prod consumer — but CANNOT be removed: bashPermissions.ts is right
// at Bun's feature() DCE complexity threshold, and deleting ~80 lines from
// that module silently breaks feature('BASH_CLASSIFIER') evaluation (drops
// every pendingClassifierCheck spread). Verified in PR #21503 round 3:
// baseline classifier tests 30/30 pass, after deletion 22/30 fail. See
// team memory: bun-feature-dce-cliff.md. Hit 3× in PR #21075 + twice in
// #21503. The expanded version lives here (the only prod consumer) instead.
//
// KEEP IN SYNC with:
//   - SAFE_WRAPPER_PATTERNS in bashPermissions.ts (text-based stripSafeWrappers)
//   - the wrapper-stripping loop in checkSemantics (src/utils/bash/ast.ts ~1860)
// If you add a wrapper in either, add it here too. Asymmetry means
// checkSemantics exposes the wrapped command to semantic checks but path
// validation sees the wrapper name → passthrough → wrapped paths never
// validated (PR #21503 review comment 2907319120).
// ───────────────────────────────────────────────────────────────────────────

// SECURITY: allowlist for timeout flag VALUES (signals are TERM/KILL/9,
// durations are 5/5s/10.5). Rejects $ ( ) ` | ; & and newlines that
// previously matched via [^ \t]+ — `timeout -k$(id) 10 ls` must NOT strip.
const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

/**
 * Parse timeout's GNU flags (long + short, fused + space-separated) and
 * return the argv index of the DURATION token, or -1 if flags are unparseable.
 */
export function skipTimeoutFlags(a) {
  let i = 1
  while (i < a.length) {
    const arg = a[i]
    const next = a[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    )
      i++
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (arg === '--') {
      i++
      break
    } // end-of-options marker
    else if (arg.startsWith('--')) return -1
    else if (arg === '-v') i++
    else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (arg.startsWith('-')) return -1
    else break
  }
  return i
}

/**
 * Parse stdbuf's flags (-i/-o/-e in fused/space-separated/long-= forms).
 * Returns argv index of wrapped COMMAND, or -1 if unparseable / no wrapped cmd.
 * Mirrors checkSemantics (ast.ts).
 *
 * SECURITY: `stdbuf <cmd>` with NO flags is NOT inert — it still execs <cmd>.
 * Earlier this returned -1 (treating zero-flag stdbuf as inert) so the wrapper
 * was left intact → baseCmd='stdbuf' → not path-restricted → the wrapped path
 * command's out-of-project paths escaped validation. Now zero-flag stdbuf is
 * stripped like any other wrapper (i===1 → return 1). KEEP IN SYNC with
 * checkSemantics (ast.ts) + the bare-stdbuf pattern in stripSafeWrappers
 * (commandStripping.mjs).
 */
export function skipStdbufFlags(a) {
  let i = 1
  while (i < a.length) {
    const arg = a[i]
    if (/^-[ioe]$/.test(arg) && a[i + 1]) i += 2
    else if (/^-[ioe]./.test(arg)) i++
    else if (/^--(input|output|error)=/.test(arg)) i++
    else if (arg.startsWith('-'))
      return -1 // unknown flag: fail closed
    else break
  }
  return i < a.length ? i : -1
}

/**
 * Parse env's VAR=val and safe flags (-i/-0/-v/-u NAME). Returns argv index
 * of wrapped COMMAND, or -1 if unparseable/no wrapped cmd. Rejects -S (argv
 * splitter), -C/-P (altwd/altpath). Mirrors checkSemantics (ast.ts).
 */
export function skipEnvFlags(a) {
  let i = 1
  while (i < a.length) {
    const arg = a[i]
    if (arg.includes('=') && !arg.startsWith('-')) i++
    else if (arg === '-i' || arg === '-0' || arg === '-v') i++
    else if (arg === '-u' && a[i + 1]) i += 2
    else if (arg.startsWith('-'))
      return -1 // -S/-C/-P/unknown: fail closed
    else break
  }
  return i < a.length ? i : -1
}

/**
 * Argv-level counterpart to stripSafeWrappers (bashPermissions.ts). Strips
 * wrapper commands from AST-derived argv. Env vars are already separated
 * into SimpleCommand.envVars so no env-var stripping here.
 */
export function stripWrappersFromArgv(argv) {
  let a = argv
  for (;;) {
    if (a[0] === 'time' || a[0] === 'nohup') {
      a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'timeout') {
      const i = skipTimeoutFlags(a)
      // SECURITY (PR #21503 round 3): unrecognized duration (`.5`, `+5`,
      // `inf` — strtod formats GNU timeout accepts) → return a unchanged.
      // Safe because checkSemantics (ast.ts) fails CLOSED on the same input
      // and runs first in bashToolHasPermission, so we never reach here.
      if (i < 0 || !a[i] || !/^\d+(?:\.\d+)?[smhd]?$/.test(a[i])) return a
      a = a.slice(i + 1)
    } else if (a[0] === 'nice') {
      // SECURITY (PR #21503 round 3): mirror checkSemantics — handle bare
      // `nice cmd` and legacy `nice -N cmd`, not just `nice -n N cmd`.
      // Previously only `-n N` was stripped: `nice rm /outside` →
      // baseCmd='nice' → passthrough → /outside never path-validated.
      if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2]))
        a = a.slice(a[3] === '--' ? 4 : 3)
      else if (a[1] && /^-\d+$/.test(a[1])) a = a.slice(a[2] === '--' ? 3 : 2)
      else a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'stdbuf') {
      // SECURITY (PR #21503 round 3): PR-WIDENED. Pre-PR, `stdbuf -o0 -eL rm`
      // was rejected by fragment check (old checkSemantics slice(2) left
      // name='-eL'). Post-PR, checkSemantics strips both flags → name='rm'
      // → passes. But stripWrappersFromArgv returned unchanged →
      // baseCmd='stdbuf' → not in SUPPORTED_PATH_COMMANDS → passthrough.
      const i = skipStdbufFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else if (a[0] === 'env') {
      // Same asymmetry: checkSemantics strips env, we didn't.
      const i = skipEnvFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else {
      return a
    }
  }
}
