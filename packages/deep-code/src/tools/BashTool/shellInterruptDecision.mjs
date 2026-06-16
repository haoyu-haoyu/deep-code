/**
 * Decide what a foreground shell command's progress loop should do when the
 * turn's abort signal fires with reason `'interrupt'` (a 'now'-priority queued
 * message arrived via the chat UI / UDS / `-p`).
 *
 * BashTool's progress loop had NO interrupt branch (unlike PowerShellTool): on
 * `abort('interrupt')` ShellCommand's #abortHandler deliberately does NOT kill
 * the child, and none of the loop's three exit conditions (resultPromise
 * resolved / backgroundShellId set / status==='backgrounded') ever becomes
 * true — so the loop spins emitting progress until the child exits on its own
 * or the 30-minute default timeout fires, wedging the turn (and orphaning the
 * child's output fd). This mirrors PowerShellTool's interrupt handling:
 *   - `'background'`: background the running command instead of killing it (the
 *     user's new message takes over; the command keeps running in the
 *     background and its partial output is preserved);
 *   - `'kill'`: when background tasks are disabled, kill the child;
 *   - `'none'`: not an interrupt, or already handled — keep looping.
 *
 * @param {{ aborted: boolean, reason: unknown,
 *           interruptBackgroundingStarted: boolean,
 *           isBackgroundTasksDisabled: boolean }} state
 * @returns {'none' | 'background' | 'kill'}
 */
export function decideInterruptAction({
  aborted,
  reason,
  interruptBackgroundingStarted,
  isBackgroundTasksDisabled,
}) {
  if (!aborted || reason !== 'interrupt' || interruptBackgroundingStarted) {
    return 'none'
  }
  return isBackgroundTasksDisabled ? 'kill' : 'background'
}
