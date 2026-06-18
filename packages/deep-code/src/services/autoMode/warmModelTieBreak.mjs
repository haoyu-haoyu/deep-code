// Warm-model tie-break for the auto-router.
//
// The DeepSeek prefix cache (~93% hit, the moat) is per-model: a turn that flips
// the lane flash<->pro re-pays the full prefix on the new lane. Within a task that
// flip is already prevented by the per-task route memo (routeMemo.mjs), but a
// BORDERLINE read-only lookup that opens a NEW task on a warm-pro session routes
// to flash — a one-off cold prefix miss on the flash lane — even though staying on
// the already-warm pro lane would be a near-full cache hit, and reasoning effort
// is outside DeepSeek's cache key (cheap to keep low).
//
// This leaf nudges such a decision back onto the warm pro lane at low effort, and
// ONLY then. It is conservative by construction:
//   - only a `flash` decision is eligible (a `pro` decision is left untouched);
//   - an explicit speed request is NEVER overridden (same SPEED signal the
//     heuristic uses, so flash-for-speed stays flash);
//   - it fires only when the pro lane's concrete model is actually WARM (its
//     prefix cache is established) — otherwise flash is no worse, so the router's
//     choice stands.
// Pure & deterministic; the caller decides (flag-gated) whether to apply it.

import { SPEED } from './classifyRouteHeuristic.mjs'

/**
 * @typedef {{ model: 'flash' | 'pro', thinking: 'off' | 'low' | 'medium' | 'high' | 'max' | 'xhigh', source: 'router' | 'heuristic', reason?: string }} RouteDecision
 * @param {RouteDecision} decision
 * @param {{ message?: string, proModel?: string, warmModels?: Set<string> }} [ctx]
 * @returns {RouteDecision}
 */
export function applyWarmModelTieBreak(decision, { message = '', proModel, warmModels } = {}) {
  // Only a borderline flash decision is eligible; a pro decision already keeps the
  // warm lane.
  if (!decision || decision.model !== 'flash') return decision
  // Never override an explicit speed request — the user asked for fast.
  if (SPEED.test(String(message).toLowerCase())) return decision
  // Only when the pro lane's concrete model has an established (warm) prefix cache,
  // so staying on it is a hit rather than the same cold miss flash would pay.
  if (!proModel || !(warmModels instanceof Set) || !warmModels.has(proModel)) {
    return decision
  }
  // Stay on the warm pro lane at low (cache-key-free) effort instead of cold flash.
  return { ...decision, model: 'pro', thinking: 'low', reason: 'warm_pro_tiebreak' }
}
