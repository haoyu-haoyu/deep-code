// Single-flight (request coalescing): while a keyed async operation is in flight,
// concurrent calls for the SAME key share that one promise instead of starting a
// second run; the entry is cleared when it settles so the NEXT call runs fresh.
//
// Generalizes the auth.ts `_refreshInProgress` idiom to a keyed map. Use it to
// serialize an operation that is NOT safe to run twice concurrently for the same
// resource — e.g. MCP reconnect, where two overlapping runs (the auto-backoff
// loop + a manual reconnect/toggle) can each tear down a connection the other
// just created and cached, leaking a live transport.
//
// The factory is invoked at most once per in-flight window for a key. The delete
// is guarded on identity so a settled run never removes a fresher entry (a fresh
// entry can only appear after this one is deleted, but the guard keeps the leaf
// correct under any caller usage).
//
// @template T
// @param {Map<string, Promise<T>>} inFlight  caller-owned map (one per call site)
// @param {string} key
// @param {() => Promise<T>} factory  starts the operation
// @returns {Promise<T>}
export function singleFlight(inFlight, key, factory) {
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}
