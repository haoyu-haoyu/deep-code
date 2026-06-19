import assert from 'node:assert/strict'
import { test } from 'node:test'

import { singleFlight } from '../src/utils/singleFlight.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('concurrent calls for the same key share ONE factory invocation and value', async () => {
  const inFlight = new Map()
  let calls = 0
  let resolveInner
  const factory = () => {
    calls++
    return new Promise(r => {
      resolveInner = r
    })
  }

  const a = singleFlight(inFlight, 'k', factory)
  const b = singleFlight(inFlight, 'k', factory)
  const c = singleFlight(inFlight, 'k', factory)
  // While in flight, the map holds exactly one entry and the factory ran once.
  await tick()
  assert.equal(calls, 1, 'factory invoked at most once per in-flight window')
  assert.equal(inFlight.size, 1)

  resolveInner('value-1')
  const [ra, rb, rc] = await Promise.all([a, b, c])
  assert.equal(ra, 'value-1')
  assert.equal(rb, 'value-1')
  assert.equal(rc, 'value-1')
  assert.equal(a, b, 'same promise object is shared')
  assert.equal(b, c)
  // settles → entry cleared so the next call runs fresh
  assert.equal(inFlight.size, 0)
})

test('sequential calls run the factory again and return distinct values (no stale dedup)', async () => {
  const inFlight = new Map()
  let n = 0
  const factory = () => Promise.resolve(`v${++n}`)

  assert.equal(await singleFlight(inFlight, 'k', factory), 'v1')
  assert.equal(inFlight.size, 0, 'map self-clears after settle')
  assert.equal(await singleFlight(inFlight, 'k', factory), 'v2')
  assert.equal(inFlight.size, 0)
})

test('different keys run independently (no cross-key serialization)', async () => {
  const inFlight = new Map()
  let aCalls = 0
  let bCalls = 0
  const pa = singleFlight(inFlight, 'a', () => (aCalls++, Promise.resolve('A')))
  const pb = singleFlight(inFlight, 'b', () => (bCalls++, Promise.resolve('B')))
  assert.equal(await pa, 'A')
  assert.equal(await pb, 'B')
  assert.equal(aCalls, 1)
  assert.equal(bCalls, 1)
})

test('a rejecting factory propagates to ALL awaiters and clears the entry (retry runs fresh)', async () => {
  const inFlight = new Map()
  let calls = 0
  const fail = () => {
    calls++
    return Promise.reject(new Error('boom'))
  }
  const a = singleFlight(inFlight, 'k', fail)
  const b = singleFlight(inFlight, 'k', fail)
  await assert.rejects(a, /boom/)
  await assert.rejects(b, /boom/)
  assert.equal(calls, 1, 'both awaiters shared the one failing run')
  assert.equal(inFlight.size, 0, 'a settled rejection still clears the entry')

  // a retry after the failure runs the factory again (no poisoned cache)
  const c = singleFlight(inFlight, 'k', () => Promise.resolve('recovered'))
  assert.equal(await c, 'recovered')
})

test('DIFFERENTIAL: a tight-overlap reconnect creates ONE connection guarded vs TWO unguarded', async () => {
  // Model reconnectMcpServerImpl: clearServerCache (await connectToServer on a
  // miss RE-CREATES a live connection) then connectToServer. Two overlapping runs
  // for the same server, RAW, each create a connection → one is orphaned (leak).
  // The single-flight guard collapses them to one run → one connection.
  let liveConnections = 0
  const reconnectRaw = async () => {
    // simulate the cache-miss re-create + the connect, with awaits between
    await tick()
    liveConnections++ // clearServerCache's connectToServer re-create
    await tick()
    return { id: liveConnections }
  }

  // RAW: no serialization → two overlapping reconnects each bump the counter.
  liveConnections = 0
  await Promise.all([reconnectRaw(), reconnectRaw()])
  assert.equal(liveConnections, 2, 'unguarded overlap creates two connections (the leak)')

  // GUARDED: single-flight collapses the overlap to exactly one run.
  liveConnections = 0
  const inFlight = new Map()
  await Promise.all([
    singleFlight(inFlight, 'server', reconnectRaw),
    singleFlight(inFlight, 'server', reconnectRaw),
  ])
  assert.equal(liveConnections, 1, 'guarded overlap creates exactly one connection')
  assert.equal(inFlight.size, 0)
})
