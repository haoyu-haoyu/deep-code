import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runCleanupsSettled } from '../src/utils/runCleanupsSettled.mjs'

test('THE FIX: a rejecting cleanup does not curtail the others (all awaited to completion)', async () => {
  let bDone = false
  const a = () => Promise.reject(new Error('telemetry backend unreachable'))
  const b = () =>
    new Promise(resolve =>
      setTimeout(() => {
        bDone = true
        resolve()
      }, 0),
    )

  // never rejects, and B has finished by the time the await returns
  await runCleanupsSettled([a, b])
  assert.equal(bDone, true)

  // contrast: the old Promise.all behavior rejects and leaves B unfinished
  // right after the throw is observed.
  let bDoneAll = false
  const bAll = () =>
    new Promise(resolve =>
      setTimeout(() => {
        bDoneAll = true
        resolve()
      }, 0),
    )
  await assert.rejects(
    Promise.all([a, bAll].map(fn => fn())),
    /unreachable/,
  )
  assert.equal(bDoneAll, false)
})

test('order-independence: rejector first or last, the sibling still completes', async () => {
  const reject = () => Promise.reject(new Error('boom'))
  for (const fns of [
    order => order,
    order => [...order].reverse(),
  ]) {
    let done = false
    const work = () =>
      new Promise(resolve =>
        setTimeout(() => {
          done = true
          resolve()
        }, 0),
      )
    await runCleanupsSettled(fns([reject, work]))
    assert.equal(done, true)
  }
})

test('a SYNCHRONOUS throw is isolated and does not abort the rest', async () => {
  let done = false
  const syncThrow = () => {
    throw new Error('synchronous boom')
  }
  const work = () =>
    new Promise(resolve =>
      setTimeout(() => {
        done = true
        resolve()
      }, 0),
    )

  // never rejects despite the synchronous throw; the bare map(fn => fn())
  // would have thrown synchronously and skipped `work` entirely.
  await runCleanupsSettled([syncThrow, work])
  assert.equal(done, true)
})

test('happy path: every cleanup runs and the await resolves after the last completes', async () => {
  const order = []
  const fns = [0, 1, 2].map(
    i => () =>
      new Promise(resolve =>
        setTimeout(() => {
          order.push(i)
          resolve()
        }, 0),
      ),
  )
  await runCleanupsSettled(fns)
  assert.deepEqual([...order].sort(), [0, 1, 2])
})

test('empty input resolves immediately', async () => {
  await runCleanupsSettled([])
})
