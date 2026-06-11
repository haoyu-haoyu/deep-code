/**
 * Finalize every pending async hook, isolating per-hook failures.
 *
 * Each hook is finalized by its completion state: a `completed` shellCommand is
 * awaited for its exit code and finalized success/error; anything else is
 * killed (unless already killed) and finalized as cancelled. The work runs
 * under Promise.allSettled — NOT Promise.all — so one hook whose finalization
 * rejects (e.g. a getStdout/getStderr/cleanup that throws during a shutdown
 * race) cannot abort the others and, critically, cannot skip the caller's
 * unconditional `pendingHooks.clear()` (a Promise.all rejection would propagate
 * out of finalizePendingAsyncHooks and leak the registry + orphan progress
 * intervals). Rejections are reported via `onError`. Mirrors the sibling
 * checkForAsyncHookResponses, which already settles to isolate failures.
 *
 * `finalizeHook` is injected so this orchestration is unit-testable without the
 * hook-event/emit machinery the real one pulls in.
 *
 * @param {Array<object>} hooks - the pending async hooks to finalize
 * @param {{
 *   finalizeHook: (hook: object, code: number, status: string) => Promise<void>,
 *   onError?: (reason: unknown) => void,
 * }} deps
 * @returns {Promise<void>} resolves once every hook has settled (never rejects)
 */
export async function finalizePendingHooks(hooks, { finalizeHook, onError = () => {} }) {
  const results = await Promise.allSettled(
    hooks.map(async hook => {
      if (hook.shellCommand?.status === 'completed') {
        const result = await hook.shellCommand.result
        await finalizeHook(
          hook,
          result.code,
          result.code === 0 ? 'success' : 'error',
        )
      } else {
        if (hook.shellCommand && hook.shellCommand.status !== 'killed') {
          hook.shellCommand.kill()
        }
        await finalizeHook(hook, 1, 'cancelled')
      }
    }),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      try {
        onError(result.reason)
      } catch {
        // The reporter must never break the settle contract. onError is a
        // best-effort logger (the production one does a synchronous file append
        // in immediate-debug mode, which can throw); if it does, swallow it so
        // finalizePendingHooks still resolves and the caller's clear() runs.
      }
    }
  }
}
