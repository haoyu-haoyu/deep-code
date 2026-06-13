// setTimeout's maximum delay (2^31 - 1 ms ≈ 24.8 days). A larger value
// silently fires IMMEDIATELY, so any delay above this must be split and
// re-armed.
export const MAX_TIMER_MS = 2_147_483_647

// Idle-exit scheduler keyed off a MONOTONIC clock so a wall-clock step cannot
// disarm it. The previous implementation armed a single setTimeout and, when
// it fired, re-checked `Date.now() - startTime >= delayMs`; a backward wall
// clock (NTP step, VM snapshot restore, laptop sleep/wake, an admin fixing a
// fast clock) made that delta read short, so the exit was SKIPPED — and the
// timer was never re-armed, leaking a headless process forever. It also broke
// for delays above MAX_TIMER_MS, which fire instantly and then read ~0 elapsed.
//
// Here the deadline is `now() + delayMs` on a monotonic `now`; each firing
// computes the monotonic `remaining` and either exits (remaining ≤ 0) or
// re-arms for the rest (firing early / delay clamped). It never disarms itself
// while idle without exiting.
export function createIdleTimeoutCore({
  delayMs,
  isIdle,
  onIdleExit,
  now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
}) {
  const isValidDelay =
    typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs > 0
  let timer = null

  function disarm() {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  function start() {
    disarm()
    if (!isValidDelay) return
    const deadline = now() + delayMs
    const arm = () => {
      const remaining = deadline - now()
      if (remaining <= 0) {
        timer = null
        // Re-confirm idle at the deadline: activity since arming clears it,
        // and a fresh start() drives the next idle period.
        if (isIdle()) {
          log(`Exiting after ${delayMs}ms of idle time`)
          onIdleExit()
        }
        return
      }
      timer = setTimer(arm, Math.min(remaining, MAX_TIMER_MS))
    }
    arm()
  }

  return { start, stop: disarm }
}
