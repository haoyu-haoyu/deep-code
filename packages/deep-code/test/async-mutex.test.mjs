import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMutex } from '../src/utils/asyncMutex.mjs'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

test('serializes overlapping operations — no two run concurrently', async () => {
  const run = createMutex()
  let active = 0
  let maxActive = 0
  const op = () =>
    run(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await tick(5) // suspension point where a naive impl would interleave
      active--
    })
  // Launch all at once; without the mutex they would overlap (maxActive > 1).
  await Promise.all([op(), op(), op(), op(), op()])
  assert.equal(maxActive, 1, 'at most one operation runs at a time')
  assert.equal(active, 0)
})

test('runs in call order', async () => {
  const run = createMutex()
  const order = []
  const tasks = [0, 1, 2, 3].map(i =>
    run(async () => {
      // Earlier-queued tasks sleep LONGER; FIFO order must still hold.
      await tick((4 - i) * 3)
      order.push(i)
    }),
  )
  await Promise.all(tasks)
  assert.deepEqual(order, [0, 1, 2, 3])
})

test('resolves with the operation result', async () => {
  const run = createMutex()
  assert.equal(await run(async () => 42), 42)
  assert.equal(await run(() => Promise.resolve('x')), 'x')
})

test('a rejecting operation does not break the chain', async () => {
  const run = createMutex()
  const seen = []
  const p1 = run(async () => {
    seen.push('a')
    throw new Error('boom')
  })
  const p2 = run(async () => {
    await tick(2)
    seen.push('b')
    return 'ok'
  })
  await assert.rejects(p1, /boom/)
  assert.equal(await p2, 'ok') // later op still ran
  assert.deepEqual(seen, ['a', 'b'])
})

test('a later op cannot start before an earlier slow op finishes (mutual exclusion across awaits)', async () => {
  const run = createMutex()
  const log = []
  const slow = run(async () => {
    log.push('slow:start')
    await tick(10)
    log.push('slow:end')
  })
  const fast = run(async () => {
    log.push('fast:start')
  })
  await Promise.all([slow, fast])
  // fast must not start until slow fully ends.
  assert.deepEqual(log, ['slow:start', 'slow:end', 'fast:start'])
})
