import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDisposableAbortListener } from '../src/utils/addDisposableAbortListener.mjs'

// Minimal EventTarget-like signal modeling addEventListener({once})/
// removeEventListener/dispatch + listenerCount, matching how AbortSignal is used.
function makeSignal() {
  const entries = new Map() // event -> Set<{fn, once}>
  return {
    addEventListener(event, fn, opts) {
      if (!entries.has(event)) entries.set(event, new Set())
      entries.get(event).add({ fn, once: !!(opts && opts.once) })
    },
    removeEventListener(event, fn) {
      const set = entries.get(event)
      if (!set) return
      for (const e of set) if (e.fn === fn) set.delete(e)
    },
    dispatch(event) {
      for (const e of [...(entries.get(event) ?? [])]) {
        if (e.once) entries.get(event).delete(e)
        e.fn()
      }
    },
    listenerCount(event) {
      return entries.get(event)?.size ?? 0
    },
  }
}

test('THE FIX: disposing on a non-abort settle removes the listener (no leak)', () => {
  const signal = makeSignal()
  let aborted = 0
  const dispose = addDisposableAbortListener(signal, () => aborted++)
  assert.equal(signal.listenerCount('abort'), 1)

  dispose()
  assert.equal(signal.listenerCount('abort'), 0)
  assert.equal(aborted, 0)

  // a later abort must NOT invoke onAbort — the listener is gone
  signal.dispatch('abort')
  assert.equal(aborted, 0)
})

test('when the signal aborts first, onAbort fires once and the listener self-removes', () => {
  const signal = makeSignal()
  let aborted = 0
  const dispose = addDisposableAbortListener(signal, () => aborted++)

  signal.dispatch('abort')
  assert.equal(aborted, 1)
  assert.equal(signal.listenerCount('abort'), 0)

  // disposing after an abort is a harmless no-op (no double-remove, no throw)
  dispose()
  assert.equal(aborted, 1)
})

test('dispose is idempotent', () => {
  const signal = makeSignal()
  let aborted = 0
  const dispose = addDisposableAbortListener(signal, () => aborted++)
  dispose()
  dispose()
  assert.equal(signal.listenerCount('abort'), 0)
  assert.equal(aborted, 0)
})

test('works against a real AbortController', () => {
  const ac = new AbortController()
  let aborted = 0
  const dispose = addDisposableAbortListener(ac.signal, () => aborted++)
  // settle some other way → dispose, then abort must not fire onAbort
  dispose()
  ac.abort()
  assert.equal(aborted, 0)

  // and the abort-first path on a fresh controller
  const ac2 = new AbortController()
  let aborted2 = 0
  addDisposableAbortListener(ac2.signal, () => aborted2++)
  ac2.abort()
  assert.equal(aborted2, 1)
})
