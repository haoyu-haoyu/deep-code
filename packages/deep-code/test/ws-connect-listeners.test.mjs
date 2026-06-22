import { test } from 'node:test'
import assert from 'node:assert/strict'

import { attachOneShotConnectListeners } from '../src/utils/wsConnectListeners.mjs'

// Minimal `ws`-style emitter exposing on/off/emit + listenerCount, matching the
// EventEmitter surface WebSocketTransport's Node branch uses.
function makeEmitter() {
  const listeners = new Map()
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn)
    },
    emit(event, ...args) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args)
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

test('on open: both temp listeners are removed and onOpen fires once', () => {
  const ws = makeEmitter()
  let opens = 0
  let errors = 0
  attachOneShotConnectListeners(ws, () => opens++, () => errors++)
  assert.equal(ws.listenerCount('open'), 1)
  assert.equal(ws.listenerCount('error'), 1)

  ws.emit('open')
  assert.equal(opens, 1)
  assert.equal(errors, 0)
  // THE FIX: both temp listeners are gone after settling
  assert.equal(ws.listenerCount('open'), 0)
  assert.equal(ws.listenerCount('error'), 0)
})

test('on connect error: both temp listeners are removed and onError fires once with the error', () => {
  const ws = makeEmitter()
  const seen = []
  attachOneShotConnectListeners(ws, () => seen.push('open'), e => seen.push(e))

  const err = new Error('ECONNREFUSED')
  ws.emit('error', err)
  assert.deepEqual(seen, [err])
  assert.equal(ws.listenerCount('open'), 0)
  assert.equal(ws.listenerCount('error'), 0)
})

test('THE BUG IT FIXES: a post-connect error does NOT re-fire the connect handler', () => {
  const ws = makeEmitter()
  let opens = 0
  let connectFails = 0
  attachOneShotConnectListeners(ws, () => opens++, () => connectFails++)

  ws.emit('open') // connection settles
  assert.equal(opens, 1)
  assert.equal(connectFails, 0)

  // a later transient error on the now-open socket must not invoke the
  // connect-fail handler (before the fix the anonymous error arrow lingered
  // and logged mcp_websocket_connect_fail + rejected the settled promise)
  ws.emit('error', new Error('transient'))
  assert.equal(connectFails, 0)
})

test('only the first settle wins: a second open is a no-op', () => {
  const ws = makeEmitter()
  let opens = 0
  attachOneShotConnectListeners(ws, () => opens++, () => {})
  ws.emit('open')
  ws.emit('open')
  assert.equal(opens, 1)
})
