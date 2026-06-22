import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isProcessRunning } from '../src/utils/isProcessRunning.mjs'

test('THE FIX: pid <= 1 is never reported as running (no pid-0 stuck lock)', () => {
  // pid 0 is the current process group: process.kill(0, 0) would SUCCEED and
  // wrongly report a corrupt lockfile (pid 0) as alive forever. The guard
  // returns false before the probe so lock recovery can reclaim it.
  assert.equal(isProcessRunning(0), false)
  // pid 1 is init/systemd, never our holder.
  assert.equal(isProcessRunning(1), false)
  // negatives and a fractional pid in (0, 1] are likewise never holders.
  assert.equal(isProcessRunning(-1), false)
  assert.equal(isProcessRunning(-99999), false)
  assert.equal(isProcessRunning(0.5), false)
})

test('a live process (the test runner itself) is reported as running', () => {
  assert.equal(isProcessRunning(process.pid), true)
  // the parent is also a real, signalable process from our perspective
  if (typeof process.ppid === 'number' && process.ppid > 1) {
    assert.equal(isProcessRunning(process.ppid), true)
  }
})

test('a pid that does not exist is reported as not running', () => {
  // An astronomically high pid is not assigned on any platform (Linux default
  // max ~4M, macOS ~99998); the probe throws ESRCH/EINVAL → caught → false.
  assert.equal(isProcessRunning(2 ** 30), false)
})
