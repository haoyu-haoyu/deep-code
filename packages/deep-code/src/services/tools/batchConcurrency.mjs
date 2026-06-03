// Pure, node-testable concurrency policy for a concurrency-safe tool batch.
//
// Sub-agent fan-out (the Agent/Task tool) is bounded by the harness `maxAgents`
// cap — a dedicated, smaller limit than the generic per-turn tool concurrency.
// Before this, maxAgents was parsed + displayed (/status, doctor, welcome) but
// NEVER enforced, so agents actually fanned out at the generic cap (default 10),
// not the advertised 4. This makes the displayed config real and caps the
// fan-out storm.
//
// Applied at the scheduler's `all(generators, cap)`, so it is a per-fan-out
// WIDTH cap, NOT a held lock — deadlock-free across nested agents (each level's
// batch caps independently; a parent never holds a slot while its children run).

/**
 * @param {object} args
 * @param {string[]} args.toolNames        names of the tools in this batch
 * @param {Iterable<string>} args.agentToolNames  the Agent/Task tool names (injected — the
 *                                          constants live in a .ts, so the caller passes them)
 * @param {number} args.genericCap         the generic per-turn tool concurrency cap
 * @param {number} args.maxAgents          the harness sub-agent cap
 * @returns {number} the concurrency to run this batch at (>= 1)
 */
export function computeBatchConcurrency({
  toolNames = [],
  agentToolNames = [],
  genericCap,
  maxAgents,
} = {}) {
  const generic = clampPositive(genericCap, 10)
  const agentNames =
    agentToolNames instanceof Set ? agentToolNames : new Set(agentToolNames)
  const hasAgent = toolNames.some(name => agentNames.has(name))
  if (!hasAgent) return generic
  // Agents present: tighten to maxAgents, but never ABOVE the generic cap (the
  // generic cap is also a hard ceiling, e.g. when a user lowers it below maxAgents).
  return Math.min(clampPositive(maxAgents, generic), generic)
}

function clampPositive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}
