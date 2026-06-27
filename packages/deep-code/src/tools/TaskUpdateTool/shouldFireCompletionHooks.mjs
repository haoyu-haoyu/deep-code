/**
 * Whether marking a task "completed" should run the blocking, side-effecting
 * TaskCompleted hooks — given the task's LIVE on-disk status, re-read just
 * before firing rather than the snapshot taken at the top of the tool call.
 *
 * TaskUpdateTool reads the task once, lock-free, then runs the completion hooks
 * before it writes. A concurrent TaskUpdate can complete the task in that
 * window, so gating the hooks on the stale snapshot re-ran them when the
 * snapshot still said e.g. "pending" but the task was already "completed" on
 * disk. Only fire when the task is not ALREADY completed.
 *
 * This closes the realistic snapshot→hooks window. It does not by itself
 * serialize two callers that BOTH re-read a non-completed status in the same
 * instant before either writes; fully eliminating that would need the per-task
 * lock held across the (arbitrary-duration) hooks or a "completing" claim
 * marker, neither of which this does.
 *
 * @param {string} liveStatus  the freshly re-read on-disk status
 * @returns {boolean}
 */
export function shouldFireCompletionHooks(liveStatus) {
  return liveStatus !== 'completed'
}
