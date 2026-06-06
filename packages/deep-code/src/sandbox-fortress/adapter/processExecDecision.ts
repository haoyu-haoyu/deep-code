import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { fortressDecisionDirective } from '../rule-engine/fortressPermission.mjs'
import { extractInvokedBinaries } from '../rule-engine/processExec.mjs'
import type { FortressViolationEvent } from '../types.js'

// A monotonically increasing violation id (process-local; uniqueness only needs to be
// per-session for the violation log).
let violationSeq = 0

function recordFortressDeny(target: string, toolName: string, dryRun: boolean): void {
  try {
    const verb = dryRun ? 'would deny' : 'denied'
    SandboxManager.recordFortressViolation({
      id: `fortress-exec-${++violationSeq}`,
      timestamp: Date.now(),
      event: { line: `Fortress ${verb} process-exec of ${target}` } as FortressViolationEvent,
      toolName,
      dryRun,
    })
  } catch {
    /* recording is best-effort — never let it break the decision */
  }
}

/**
 * The per-call fortress decision for a Bash COMMAND against `process-exec` rules
 * (F3 follow-up — the Bash analog of checkFortressFileDecision/PR-F). The command is
 * split into its subcommands by the proven splitCommand_DEPRECATED, then the head binary
 * of each (`rm`, `curl`, `/bin/sh`, …) is matched against the fortress matcher.
 *
 * BEST-EFFORT / DEFENSE-IN-DEPTH, NOT a hard boundary: static analysis of a shell
 * command can never be airtight — a crafted command can obfuscate the binary it runs
 * (`bash -c "$(...)"`, `eval`, base64, …). This catches the obvious/direct invocations.
 *
 * MATCHED RULES ONLY: it enforces only an EXPLICIT process-exec rule that matches a
 * binary. A no-match deny (the paranoid/effort-'max' default, which would otherwise block
 * EVERY un-ruled command) is deliberately ignored here — that blanket floor is the
 * separately-deferred "paranoid floor" item. So with no process-exec rules the call is
 * inert (returns null) and behavior is byte-identical to today.
 *
 * Returns a PermissionDecision (deny/ask) when a process-exec rule blocks/prompts, or
 * `null` to DEFER to the host's normal Bash permission flow. Fail-safe: any parse or
 * lookup error defers (never blocks the host). Violation recording is separately
 * best-effort — a recording failure never changes the decision.
 *
 * @param command  the raw Bash command string (input.command).
 * @param toolName for the violation record (e.g. 'Bash').
 */
export function checkFortressProcessExecDecision(command: string, toolName: string): PermissionDecision | null {
  if (typeof command !== 'string' || command.trim() === '') return null

  let binaries: string[]
  try {
    binaries = extractInvokedBinaries(splitCommand_DEPRECATED(command))
  } catch {
    return null // unparseable command → DEFER (best-effort; never block on a parse error)
  }
  if (binaries.length === 0) return null

  const evaluated: Array<{ target: string; directive: ReturnType<typeof fortressDecisionDirective> }> = []
  try {
    const dryRun = SandboxManager.isDryRunMode()
    for (const bin of binaries) {
      const decision = SandboxManager.resolveFortressDecision('process-exec', bin)
      const directive = fortressDecisionDirective(decision, { dryRun })
      // Enforce only an EXPLICIT matched rule. directive.matched is false for both the
      // paranoid no-match deny AND the internal-error fail-safe default (rule == null),
      // so either way an un-ruled binary defers — never the blanket floor, never a block
      // on a lookup error.
      if (!directive.matched) continue
      evaluated.push({ target: bin, directive })
    }
  } catch {
    return null // fail-safe: any fortress error → defer
  }
  if (evaluated.length === 0) return null

  // Record the matched-deny that blocks (or, in dry-run, the would-be deny). One record
  // per command — recording every denied binary would be noisy.
  const recordHit = evaluated.find(e => e.directive.record)
  if (recordHit) recordFortressDeny(recordHit.target, toolName, recordHit.directive.dryRun)

  // deny-first across the invoked binaries: a deny on ANY blocks the whole command.
  const denyHit = evaluated.find(e => e.directive.enforce === 'deny')
  if (denyHit) {
    return {
      behavior: 'deny',
      message: `Blocked by a DeepCode Sandbox Fortress rule: running '${denyHit.target}' is denied.`,
      decisionReason: { type: 'other', reason: 'fortress:process-exec:deny' },
    }
  }
  const askHit = evaluated.find(e => e.directive.enforce === 'ask')
  if (askHit) {
    return {
      behavior: 'ask',
      message: `A DeepCode Sandbox Fortress rule requires confirmation to run '${askHit.target}'.`,
      decisionReason: { type: 'other', reason: 'fortress:process-exec:ask' },
    }
  }
  return null // 'defer' → host's normal Bash permission flow decides
}
