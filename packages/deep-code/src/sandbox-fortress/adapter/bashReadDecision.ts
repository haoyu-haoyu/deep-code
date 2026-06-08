import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { getCwd } from '../../utils/cwd.js'
import { getPathsForPermissionCheck } from '../../utils/fsOperations.js'
import { expandPath } from '../../utils/path.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { extractBashReadPaths } from '../rule-engine/bashReadPaths.mjs'
import { fortressDecisionDirective, fortressRecordVerb } from '../rule-engine/fortressPermission.mjs'
import { isAllowlistedRead } from '../rule-engine/systemReadAllowlist.mjs'
import type { FortressViolationEvent } from '../types.js'

// A monotonically increasing violation id (process-local; per-session uniqueness only).
let violationSeq = 0

function recordFortressDecision(
  target: string,
  toolName: string,
  dryRun: boolean,
  action: 'deny' | 'ask' | undefined,
): void {
  try {
    // Shared verb so a would-be ASK (recorded only in dry-run) is never mislogged as a deny.
    const verb = fortressRecordVerb(action, dryRun)
    SandboxManager.recordFortressViolation({
      id: `fortress-read-${++violationSeq}`,
      timestamp: Date.now(),
      event: { line: `Fortress ${verb} fs-read of ${target}` } as FortressViolationEvent,
      toolName,
      dryRun,
    })
  } catch {
    /* recording is best-effort — never let it break the decision */
  }
}

/**
 * The F3 paranoid fs-READ floor for the Bash tool (the last deferred Sandbox-Fortress
 * item). At effort 'max' the rule engine's no-match default is 'deny', already enforced
 * for the Read/Edit/Write TOOLS via checkFortressFileDecision (PR-F); the residual gap is
 * filesystem reads performed by a BASH COMMAND (`cat ~/.aws/creds`). The OS sandbox can't
 * close it (reads are default-allow and macOS `allowRead` wins over `denyRead` — a
 * verified fail-open), so we enforce per-call at the concrete target, the same faithful
 * mechanism the Read-tool floor uses.
 *
 * GATED ON PARANOID: returns null immediately unless the default decision is 'deny'
 * (effort 'max'), so it is fully inert below 'max' — no behavior change, no cache impact.
 * At 'max', for each literal read path extracted from a reader command we resolve it
 * against the LIVE shell cwd and through the SYMLINK chain (getPathsForPermissionCheck),
 * then for each resolved form:
 *   • a MATCHED user fs-read deny → deny (enforced regardless of the allowlist);
 *   • a no-match PARANOID deny → deny ONLY if the path is NOT a system path and NOT under
 *     a configured workspace dir (the allowlist keeps the shell able to read libs/the
 *     workspace; a `~user` token is treated as un-allowlistable since expandPath can't
 *     resolve it the way the shell would);
 *   • a matched fs-read ask rule → ask; allow / anything else → defer.
 * deny-first across paths + resolved forms; hard-DENY (the product decision for the
 * over-block case); records only matched denies (the no-match floor is not logged,
 * matching the file-tool floor); dry-run defers + records. Fail-safe: any parse/resolve/
 * lookup error defers.
 *
 * BEST-EFFORT (see bashReadPaths.mjs): only direct `reader /path` forms are caught.
 * Misses: wrapped readers (`sudo cat`), exotic readers, `< file` redirection, embedded
 * `--flag=path`, runtime indirection ($VAR / $(...) / eval), and two state-mid-command
 * cases — a RELATIVE read after an in-command `cd` (`cd ~/.aws && cat creds`; the cwd
 * change isn't statically followed) and a symlink CREATED in the same command
 * (`ln -s … x && cat x`; x doesn't exist at check time). PRE-EXISTING symlinks ARE
 * resolved, so a persistent symlink can't bypass the floor or a matched deny.
 *
 * @param command          the raw Bash command string (input.command).
 * @param toolName          for the violation record (e.g. 'Bash').
 * @param getWorkspaceDirs  a thunk returning the configured workspace dirs that are exempt
 *                          from the floor — the SYMLINK-RESOLVED forms of (originalCwd ∪
 *                          additionalWorkingDirectories). NOT the live cwd (`cd ~` must not
 *                          make $HOME a workspace). Resolved forms are required because the
 *                          read target is symlink-resolved too: a project behind a symlink
 *                          (`~/work → /Volumes/SSD/work`) would otherwise have every read
 *                          resolve outside the lexical anchor and be denied. The thunk is
 *                          invoked ONLY after the paranoid gate (so below 'max' there is no
 *                          working-dir resolution / FS cost) and inside the fail-safe try.
 */
export function checkFortressBashReadDecision(
  command: string,
  toolName: string,
  getWorkspaceDirs?: () => readonly string[],
): PermissionDecision | null {
  if (typeof command !== 'string' || command.trim() === '') return null

  // Gate: only the paranoid posture (effort 'max') activates the read floor.
  let isParanoid = false
  try {
    isParanoid = SandboxManager.getDefaultDecision() === 'deny'
  } catch {
    return null // fail-safe: if we can't read the posture, do nothing
  }
  if (!isParanoid) return null

  let readTokens: string[]
  try {
    readTokens = extractBashReadPaths(splitCommand_DEPRECATED(command))
  } catch {
    return null // unparseable command → defer (never block on a parse error)
  }
  if (readTokens.length === 0) return null

  const cwd = getCwd() // LIVE shell cwd (mutated by `cd`) — resolve relative tokens here
  const evaluated: Array<{ target: string; directive: ReturnType<typeof fortressDecisionDirective> }> = []
  try {
    const dryRun = SandboxManager.isDryRunMode()
    // The symlink-RESOLVED workspace dirs (the read target is symlink-resolved too, so a
    // project behind a symlink must match its realpath form). Computed once, lazily, only
    // now that we're past the paranoid gate; a throw defers via the outer catch.
    const wsDirs = typeof getWorkspaceDirs === 'function' ? getWorkspaceDirs() : []
    for (const tok of readTokens) {
      // a `~user` / `~user/…` token is a tilde HOME expansion expandPath can't resolve (it
      // only handles '~' and '~/…'); it would resolve as relative under cwd, wrongly
      // workspace-exempt while the shell reads another user's home (`cat ~alice/.ssh/x`,
      // `tree ~root`). Mark EVERY `~`-prefixed token except plain '~' and '~/…' as
      // un-allowlistable (let it floor). We deliberately do NOT try to recognize a "valid
      // username" shape: bash takes everything up to the first '/' as the login name and
      // asks the account DB, so a character-class heuristic would MISS real names like
      // `john.doe`/`svc$`/digit-start and re-open the fail-open. The cost is a rare, SAFE
      // OVER-BLOCK of a literal file whose name starts with '~' (read it as `./~name` or
      // add an explicit fortress allow rule) — never a fail-open.
      const tildeUser = tok.startsWith('~') && tok !== '~' && !tok.startsWith('~/')
      let abs: string
      try {
        abs = expandPath(tok, cwd)
      } catch {
        continue // a token we can't resolve (null bytes, bad type) → skip it
      }
      if (typeof abs !== 'string' || abs === '') continue
      // resolve the symlink chain so a (pre-existing) symlink to an un-ruled/denied path
      // can't bypass the floor or a matched deny — evaluate every resolved form deny-first.
      let resolvedSet: string[]
      try {
        resolvedSet = getPathsForPermissionCheck(abs)
      } catch {
        resolvedSet = [abs]
      }
      if (!Array.isArray(resolvedSet) || resolvedSet.length === 0) resolvedSet = [abs]
      for (const target of resolvedSet) {
        if (typeof target !== 'string' || target === '') continue
        const decision = SandboxManager.resolveFortressDecision('fs-read', target)
        // resolveDecision tags its internal-error fail-safe path with reason 'error:fail-safe'
        // (it returns the effort default, 'deny' at paranoid) — treat as defer (skip).
        if (decision != null && typeof decision === 'object' && decision.reason === 'error:fail-safe') continue
        const directive = fortressDecisionDirective(decision, { dryRun })
        // Exempt a no-match PARANOID deny on a system/workspace path from the floor so the
        // shell can read libs/the workspace. A MATCHED user deny and a ~user token are
        // never exempt.
        if (
          !directive.matched &&
          directive.enforce === 'deny' &&
          !tildeUser &&
          isAllowlistedRead(target, wsDirs)
        ) {
          continue
        }
        evaluated.push({ target, directive })
      }
    }
  } catch {
    return null // fail-safe: any fortress error → defer
  }
  if (evaluated.length === 0) return null

  // Record the matched event that blocks (or, in dry-run, the would-be deny OR would-be
  // ask). One record per command. The no-match paranoid floor is not recorded (no spam).
  const recordHit = evaluated.find(e => e.directive.record)
  if (recordHit) recordFortressDecision(recordHit.target, toolName, recordHit.directive.dryRun, recordHit.directive.action)

  // deny-first across the read paths + their resolved forms: a deny on ANY blocks the
  // whole command (hard-DENY).
  const denyHit = evaluated.find(e => e.directive.enforce === 'deny')
  if (denyHit) {
    return {
      behavior: 'deny',
      message: `Blocked by a DeepCode Sandbox Fortress rule: reading '${denyHit.target}' is denied at this effort level.`,
      decisionReason: { type: 'other', reason: 'fortress:fs-read:deny' },
    }
  }
  const askHit = evaluated.find(e => e.directive.enforce === 'ask')
  if (askHit) {
    return {
      behavior: 'ask',
      message: `A DeepCode Sandbox Fortress rule requires confirmation to read '${askHit.target}'.`,
      decisionReason: { type: 'other', reason: 'fortress:fs-read:ask' },
    }
  }
  return null // 'defer' → host's normal Bash permission flow decides
}
