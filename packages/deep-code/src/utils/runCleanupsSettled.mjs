/**
 * Run a set of best-effort cleanup functions to completion, isolating failures.
 *
 * The graceful-shutdown path registers dozens of independent, best-effort cleanups
 * (session-transcript flush, prompt-history flush, telemetry shutdown, tmux
 * kill, proxy stop, native-installer cleanup, ...) and awaits them within a
 * dedicated time budget so the most critical ones — persisting session and
 * prompt-history data — are guaranteed to finish before the process exits.
 *
 * `Promise.all` is the wrong primitive here: it REJECTS as soon as the FIRST
 * cleanup rejects, so its awaiter stops waiting and the other still-running
 * cleanups lose their guaranteed budget. A slow/unreachable telemetry backend
 * (the telemetry shutdown cleanup is always registered and rethrows on
 * failure/timeout) — or any single failing cleanup — would curtail the awaited
 * completion of the session/history flush, defeating the documented "flush
 * session data first" guarantee and risking lost data on exit. A rejecting
 * cleanup must NOT curtail its siblings.
 *
 * `Promise.allSettled` waits for every cleanup to settle regardless of
 * failures. Each fn is invoked via `Promise.resolve().then(fn)` so that even a
 * SYNCHRONOUS throw becomes a rejected promise allSettled tolerates, instead of
 * escaping the `.map()` and aborting the rest (which is what the bare
 * `map(fn => fn())` did). On the happy path this is identical to `Promise.all`:
 * all cleanups run concurrently and the returned promise resolves once they
 * have all completed.
 *
 * @param {Array<() => (void | Promise<void>)>} fns
 * @returns {Promise<void>}
 */
export async function runCleanupsSettled(fns) {
  await Promise.allSettled(fns.map(fn => Promise.resolve().then(fn)))
}
