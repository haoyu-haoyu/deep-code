// Generic per-turn tool concurrency cap, shared by BOTH execution paths — the
// batched scheduler (toolOrchestration.ts) and the streaming executor
// (StreamingToolExecutor.ts) — so they enforce one source of truth instead of
// drifting. Reads the same env overrides; defaults to 10. `env` injectable for
// tests.
export function getMaxToolUseConcurrency(env = process.env) {
  return (
    parseInt(
      env.DEEPCODE_MAX_TOOL_USE_CONCURRENCY ||
        env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ||
        '',
      10,
    ) || 10
  )
}
