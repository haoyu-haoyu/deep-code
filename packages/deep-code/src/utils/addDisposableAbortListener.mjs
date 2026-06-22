/**
 * Add a one-shot 'abort' listener to an AbortSignal and return a disposer that
 * removes it.
 *
 * Long-lived (turn- or session-scoped) AbortSignals are shared across many
 * short-lived awaited operations. Each operation that wants to bail on abort
 * registers an `{ once: true }` listener — but `once` only self-removes when the
 * signal ACTUALLY aborts. If the operation instead settles some other way
 * (a response arrives, the user allows/rejects), its abort listener lingers on
 * the signal, holding the captured closure alive and accumulating toward the
 * signal's max-listener cap (a warning + retained memory over a long turn).
 *
 * Call the returned disposer on every NON-abort resolution path so the listener
 * comes off as soon as the operation settles. The disposer is idempotent and a
 * no-op once the signal has aborted (the one-shot listener has already removed
 * itself), so it is always safe to call.
 *
 * @param {{ addEventListener: Function, removeEventListener: Function }} signal
 * @param {() => void} onAbort  invoked once, only if the signal aborts first
 * @returns {() => void} dispose  removes the listener (idempotent)
 */
export function addDisposableAbortListener(signal, onAbort) {
  let live = true
  const handler = () => {
    live = false
    onAbort()
  }
  signal.addEventListener('abort', handler, { once: true })
  return () => {
    if (!live) return
    live = false
    signal.removeEventListener('abort', handler)
  }
}
