import { expandPath } from '../../utils/path.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { fortressDecisionDirective, fortressRecordVerb } from '../rule-engine/fortressPermission.mjs'
import type { FortressViolationEvent, ResourceKind } from '../types.js'

// A monotonically increasing violation id (process-local; uniqueness only needs to be
// per-session for the violation log).
let violationSeq = 0

function recordFortressDecision(
  resource: ResourceKind,
  target: string,
  toolName: string,
  dryRun: boolean,
  action: 'deny' | 'ask' | undefined,
): void {
  try {
    // Label by the matched action (shared verb) so a would-be ASK (recorded only in
    // dry-run) is never mislogged as a deny.
    const verb = fortressRecordVerb(action, dryRun)
    SandboxManager.recordFortressViolation({
      id: `fortress-file-${++violationSeq}`,
      timestamp: Date.now(),
      event: { line: `Fortress ${verb} ${resource} on ${target}` } as FortressViolationEvent,
      toolName,
      dryRun,
    })
  } catch {
    /* recording is best-effort — never let it break the decision */
  }
}

/**
 * The per-call fortress decision for a FILE TOOL operating on a concrete path set
 * (F3 wiring PR-F). This is the FAITHFUL enforcement path: the absolute target is
 * known, so the fortress matcher applies its real glob/path semantics with no OS
 * translation — it enforces fs-read denies and the non-projectable glob/relative
 * fs-write patterns that the Bash OS-pattern path (PR-D) deferred.
 *
 * `paths` is the SYMLINK-RESOLVED set (getPathsForPermissionCheck) so a fortress deny
 * can't be bypassed by an in-workspace symlink — every resolved path is evaluated and a
 * deny on ANY of them blocks (deny-first across the set), mirroring the host's own
 * deny-rule loops. Each path is expandPath'd defensively.
 *
 * Returns a PermissionDecision (deny/ask) when the fortress has a BLOCKING opinion, or
 * `null` to DEFER to the host's normal permission flow. The default state is inert: no
 * rules + effort 'off' → no-match 'ask' → defer → null, so behavior is byte-identical to
 * today. Fail-safe on the DECISION path: any path-resolution or decision-lookup error
 * defers (never blocks the host). Violation RECORDING is separately best-effort — a
 * recording failure is swallowed and never changes the decision (a real deny still
 * blocks; the audit just didn't log).
 *
 * @param resource 'fs-read' for Read; 'fs-write' for Edit/Write (chosen by the caller).
 * @param paths the resolved path set (or a single path) to evaluate.
 * @param toolName for the violation record.
 */
export function checkFortressFileDecision(
  resource: ResourceKind,
  paths: readonly string[] | string,
  toolName: string,
): PermissionDecision | null {
  const pathList = Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : []
  if (pathList.length === 0) return null

  const evaluated: Array<{ target: string; directive: ReturnType<typeof fortressDecisionDirective> }> = []
  try {
    const dryRun = SandboxManager.isDryRunMode()
    for (const p of pathList) {
      let target: string
      try {
        target = expandPath(p)
      } catch {
        return null // a member that can't be resolved → DEFER the whole call (internal
        // error must never block; don't enforce on a partially-evaluable set)
      }
      if (typeof target !== 'string' || target === '') return null
      const decision = SandboxManager.resolveFortressDecision(resource, target)
      // resolveDecision tags its internal-error fail-safe path with reason
      // 'error:fail-safe' (returning the effort default, which is 'deny' at paranoid).
      // Treat that as an internal error → DEFER, never block the host on a lookup error.
      if (decision != null && typeof decision === 'object' && decision.reason === 'error:fail-safe') {
        return null
      }
      evaluated.push({ target, directive: fortressDecisionDirective(decision, { dryRun }) })
    }
  } catch {
    return null // fail-safe: any fortress error → defer
  }
  if (evaluated.length === 0) return null

  // Record the matched event that blocks/prompts (or, in dry-run, the would-be deny OR
  // would-be ask). One record per operation — recording across every resolved path would
  // be noisy.
  const recordHit = evaluated.find(e => e.directive.record)
  if (recordHit)
    recordFortressDecision(resource, recordHit.target, toolName, recordHit.directive.dryRun, recordHit.directive.action)

  // deny-first across the resolved set: a deny on ANY resolved path blocks.
  const denyHit = evaluated.find(e => e.directive.enforce === 'deny')
  if (denyHit) {
    return {
      behavior: 'deny',
      message: `Blocked by a DeepCode Sandbox Fortress rule: ${resource} access to ${denyHit.target} is denied.`,
      decisionReason: { type: 'other', reason: `fortress:${resource}:deny` },
    }
  }
  const askHit = evaluated.find(e => e.directive.enforce === 'ask')
  if (askHit) {
    return {
      behavior: 'ask',
      message: `A DeepCode Sandbox Fortress rule requires confirmation for ${resource} access to ${askHit.target}.`,
      decisionReason: { type: 'other', reason: `fortress:${resource}:ask` },
    }
  }
  return null // 'defer' → host's normal permission flow decides
}
