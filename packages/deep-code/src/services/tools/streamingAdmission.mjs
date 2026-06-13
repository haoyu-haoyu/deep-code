// Pure, node-testable admission policy for the streaming tool executor.
//
// The executor's canExecuteTool only checked COMPATIBILITY — a concurrency-safe
// candidate may join a batch of concurrency-safe tools — but enforced NO count
// cap. Because executeTool registers a tool as 'executing' synchronously and
// fires without awaiting completion, N queued concurrency-safe tools all start
// AT ONCE: an unbounded fan-out that re-breaks the generic per-turn concurrency
// cap and the harness `maxAgents` sub-agent cap (so an Agent/Task batch could
// launch far past the advertised limit). This bounds admission the same way
// computeBatchConcurrency bounds the batched path, keeping the two consistent.
//
// `runningAllConcurrencySafe` is whether EVERY currently-executing tool is
// concurrency-safe (the caller computes it). Returns whether the candidate may
// start now; a `false` leaves it queued until a slot frees (processQueue re-runs
// on each completion), so this is back-pressure, not a dropped tool.
export function computeStreamingAdmission({
  candidateIsConcurrencySafe,
  candidateIsAgent = false,
  runningCount,
  runningAllConcurrencySafe,
  runningAgentCount = 0,
  genericCap,
  maxAgents,
} = {}) {
  // Always admit the first tool — matches the prior `executingTools.length === 0`
  // branch, which let even a non-concurrency-safe tool run when nothing else was.
  if (runningCount <= 0) return true
  // A non-concurrency-safe tool must run alone; it can never join a running
  // batch (same as the prior gate — it only ran when nothing else executed).
  if (!candidateIsConcurrencySafe || !runningAllConcurrencySafe) return false
  // Concurrency-safe alongside a concurrency-safe batch: bounded by the generic
  // per-turn cap (the missing check that allowed unbounded fan-out).
  const generic = clampPositive(genericCap, 10)
  if (runningCount >= generic) return false
  // An Agent/Task candidate is additionally bounded by the smaller harness
  // sub-agent cap (never above the generic ceiling, matching computeBatchConcurrency).
  if (candidateIsAgent) {
    const agentCap = Math.min(clampPositive(maxAgents, generic), generic)
    if (runningAgentCount >= agentCap) return false
  }
  return true
}

function clampPositive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}
