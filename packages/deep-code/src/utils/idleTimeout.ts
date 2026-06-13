import { performance } from 'node:perf_hooks'
import { logForDebugging } from './debug.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { createIdleTimeoutCore } from './idleTimeoutCore.mjs'

/**
 * Creates an idle timeout manager for SDK mode.
 * Automatically exits the process after the specified idle duration.
 *
 * The deadline is tracked on a MONOTONIC clock (performance.now) so a
 * wall-clock step (NTP, VM snapshot, sleep/wake) cannot leak the process by
 * disarming the exit — see idleTimeoutCore.mjs.
 *
 * @param isIdle Function that returns true if the system is currently idle
 * @returns Object with start/stop methods to control the idle timer
 */
export function createIdleTimeoutManager(isIdle: () => boolean): {
  start: () => void
  stop: () => void
} {
  // Parse CLAUDE_CODE_EXIT_AFTER_STOP_DELAY environment variable
  const exitAfterStopDelay = process.env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY
  const parsed = exitAfterStopDelay ? parseInt(exitAfterStopDelay, 10) : NaN
  const delayMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null

  return createIdleTimeoutCore({
    delayMs,
    isIdle,
    onIdleExit: gracefulShutdownSync,
    now: () => performance.now(),
    log: logForDebugging,
  })
}
