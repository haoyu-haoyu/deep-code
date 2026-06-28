// Stall watchdog for a slow-trickle ("slowloris") response body.
//
// axios's `timeout` is a per-CHUNK inactivity timer (it resets on every byte
// received), and maxContentLength only fires once the body exceeds the cap. So a
// hostile server can send the response headers, then dribble one byte every
// <timeout seconds, keeping the total under the cap forever — the request never
// completes and the socket + tool slot are held indefinitely.
//
// This is a minimum-THROUGHPUT guard rather than a blunt absolute deadline, so it
// does NOT regress a legitimate slow-but-progressing large download: it only aborts
// when the body fails to advance by `minBytesPerWindow` within `windowMs` AFTER the
// download has started. A real download at any sane rate clears the (very low) floor;
// a trickle of a few bytes per minute does not. Slow response HEADERS are unaffected
// (the watchdog arms on the first body-progress event) and stay bounded by the
// existing per-request connect/idle timeout.
//
// Pure value-in/value-out reducer (the impure setInterval / Date.now / abort wiring
// lives in the .ts caller) so it is node-testable.

/** @returns {{armed: boolean, done: boolean, markBytes: number, markTime: number}} */
export function makeWatchdogState() {
  return { armed: false, done: false, markBytes: 0, markTime: 0 }
}

/**
 * Fold a download-progress sample into the watchdog state.
 *  - The FIRST sample arms the watchdog (download has started) and sets the mark.
 *  - A sample that advanced >= minBytesPerWindow since the last mark resets the mark
 *    (forward progress observed) so the window restarts.
 *  - When total is known and loaded >= total the body is complete -> `done` (never
 *    stalls, so a fully-received body waiting on socket close is not false-aborted).
 *
 * @param {object} state
 * @param {number} loaded cumulative bytes received
 * @param {number|undefined} total total bytes if known (Content-Length), else falsy
 * @param {number} now monotonic-ish timestamp (ms)
 * @param {number} minBytesPerWindow
 * @returns {object} next state
 */
export function recordProgress(state, loaded, total, now, minBytesPerWindow) {
  if (state.done) return state
  if (total && total > 0 && loaded >= total) {
    return { ...state, done: true }
  }
  if (!state.armed) {
    return { armed: true, done: false, markBytes: loaded, markTime: now }
  }
  if (loaded - state.markBytes >= minBytesPerWindow) {
    return { armed: true, done: false, markBytes: loaded, markTime: now }
  }
  return state
}

/**
 * Whether the download has stalled: armed, not complete, and no `minBytesPerWindow`
 * of progress within the last `windowMs`.
 *
 * @param {object} state
 * @param {number} now
 * @param {number} windowMs
 * @returns {boolean}
 */
export function isStalled(state, now, windowMs) {
  return state.armed && !state.done && now - state.markTime >= windowMs
}
