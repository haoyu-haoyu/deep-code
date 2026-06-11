/**
 * Wait `ms`, but reject as soon as `signal` aborts — so a Ctrl-C / Esc during a
 * retry backoff is observed promptly instead of after the full delay (and then
 * issuing one doomed already-aborted request). Throws the signal's abort reason,
 * the same value `fetch()` rejects with on abort, so a caller sees a uniform
 * AbortError whether the abort lands mid-request or mid-backoff.
 *
 * @param {number} ms - delay in milliseconds
 * @param {AbortSignal | undefined} signal - the caller's cancellation signal
 * @param {(ms: number) => Promise<void>} sleep - injectable timer (for tests)
 * @returns {Promise<void>}
 */
export async function abortableDelay(ms, signal, sleep) {
  if (!signal) {
    await sleep(ms)
    return
  }
  if (signal.aborted) throw abortReason(signal)

  let onAbort
  try {
    await Promise.race([
      // Pass the signal so a cancellable sleep (the real sleepMs) CLEARS its
      // timer on abort — otherwise the abandoned timer keeps the event loop
      // alive for the whole backoff even though this await already rejected.
      sleep(ms, signal),
      new Promise((_resolve, reject) => {
        onAbort = () => reject(abortReason(signal))
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }

  // An injected (or real) sleep may settle in the same tick the signal aborts;
  // re-check so an abort that lands as the timer fires still throws rather than
  // letting the retry loop issue another request.
  if (signal.aborted) throw abortReason(signal)
}

/**
 * The value to throw/reject with on abort — the signal's reason, matching what
 * `fetch()` rejects with, so callers see a uniform AbortError. Falls back to a
 * fresh AbortError DOMException on the (older-runtime) chance reason is unset.
 *
 * @param {AbortSignal} signal
 * @returns {unknown}
 */
export function abortReason(signal) {
  return signal.reason !== undefined
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
