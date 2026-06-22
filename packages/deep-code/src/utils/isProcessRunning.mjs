/**
 * Check whether a process with the given PID is currently running, using a
 * signal-0 probe: `process.kill(pid, 0)` sends no signal — it only checks
 * whether the caller could signal the process — so it is a cheap liveness
 * test used by every lock-recovery caller (cron/session/dream locks, the
 * native-installer pid lock, the IDE lockfile, the computer-use lock).
 *
 * PID <= 1 is never a legitimate lock holder and is reported as NOT running:
 *   - 0 refers to the CURRENT process group, so `process.kill(0, 0)` would
 *     spuriously SUCCEED and report a corrupt/garbage lockfile (one that
 *     recorded pid 0) as alive forever — wedging lock recovery so the lock
 *     can never be reclaimed.
 *   - 1 is init/systemd, never our holder.
 * Guarding here keeps a 0/garbage recorded pid from being mistaken for a
 * live holder. Two of the four pre-consolidation copies (ide, computer-use)
 * lacked this guard and so were vulnerable to the pid-0 stuck-lock bug.
 *
 * Any error from the probe (including EPERM — the process exists but is owned
 * by another user) is reported as NOT running, matching the existing
 * lock-recovery callers, which all caught every error as "not running".
 *
 * @param {number} pid
 * @returns {boolean} true iff a signalable process with this pid exists
 */
export function isProcessRunning(pid) {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
