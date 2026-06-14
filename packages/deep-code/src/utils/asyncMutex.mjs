// A minimal async mutex: serializes async operations so they run one at a time
// in call order. createMutex() returns a `run(fn)` that queues `fn` behind any
// in-flight or already-queued operation and resolves with `fn`'s result.
//
// A rejecting operation does NOT break the chain — the internal tail swallows
// outcomes so later operations still run; only the caller's own `run()` promise
// rejects. This makes it safe to guard heterogeneous file operations whose
// failures are handled (or ignored) by their own callers.
export function createMutex() {
  let tail = Promise.resolve()
  return function run(fn) {
    const result = tail.then(() => fn())
    tail = result.then(
      () => {},
      () => {},
    )
    return result
  }
}
