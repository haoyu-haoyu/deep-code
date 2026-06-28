import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isStalled,
  makeWatchdogState,
  recordProgress,
} from '../src/tools/WebFetchTool/throughputWatchdog.mjs'

const WINDOW = 60_000
const MIN = 1024

// Drive a sequence of [loaded, total, now] samples and return final state.
function drive(samples) {
  let s = makeWatchdogState()
  for (const [loaded, total, now] of samples) {
    s = recordProgress(s, loaded, total, now, MIN)
  }
  return s
}

test('initial state is not armed and not stalled', () => {
  const s = makeWatchdogState()
  assert.equal(isStalled(s, 1_000_000, WINDOW), false)
})

test('arms on first progress; not stalled within the window', () => {
  const s = drive([[0, 0, 1000]])
  assert.equal(s.armed, true)
  assert.equal(isStalled(s, 1000 + WINDOW - 1, WINDOW), false)
  // exactly at the window with no further progress -> stalled
  assert.equal(isStalled(s, 1000 + WINDOW, WINDOW), true)
})

test('THE FIX: a trickle (< MIN bytes per window) is detected as stalled', () => {
  // 1 byte every 30s — never advances MIN(1024) within a 60s window.
  let s = makeWatchdogState()
  let t = 0
  let loaded = 0
  for (let i = 0; i < 5; i++) {
    t += 30_000
    loaded += 1
    s = recordProgress(s, loaded, 0, t, MIN)
  }
  // armed at t=30000 (loaded=1), mark never advanced by >=1024 since
  assert.equal(s.armed, true)
  assert.equal(s.markTime, 30_000)
  assert.equal(isStalled(s, 30_000 + WINDOW, WINDOW), true)
})

test('a healthy steady download is NEVER stalled (mark keeps advancing)', () => {
  // ~50 KB/s: 50_000 bytes per second, sampled each second for 10s.
  let s = makeWatchdogState()
  for (let sec = 1; sec <= 10; sec++) {
    s = recordProgress(s, sec * 50_000, 0, sec * 1000, MIN)
    // at every point, the mark is current -> never stalled at "now"
    assert.equal(isStalled(s, sec * 1000, WINDOW), false)
  }
  // and not stalled shortly after the last sample
  assert.equal(isStalled(s, 10_000 + WINDOW - 1, WINDOW), false)
})

test('a burst then a long silence IS stalled after the window', () => {
  // big burst at t=1s, then nothing.
  const s = drive([[5_000_000, 0, 1000]])
  assert.equal(isStalled(s, 1000 + WINDOW - 1, WINDOW), false)
  assert.equal(isStalled(s, 1000 + WINDOW, WINDOW), true)
})

test('completion via total -> done, never stalls (no tail false-abort)', () => {
  // body fully received at t=1s, then the socket lingers > window before close.
  const s = drive([
    [500, 1000, 500],
    [1000, 1000, 1000], // loaded >= total -> done
  ])
  assert.equal(s.done, true)
  assert.equal(isStalled(s, 1000 + WINDOW * 5, WINDOW), false)
})

test('progress of exactly MIN within the window resets the mark', () => {
  let s = recordProgress(makeWatchdogState(), 0, 0, 0, MIN) // arm at t=0
  s = recordProgress(s, MIN, 0, 30_000, MIN) // +MIN at t=30s -> mark resets
  assert.equal(s.markBytes, MIN)
  assert.equal(s.markTime, 30_000)
  assert.equal(isStalled(s, 30_000 + WINDOW - 1, WINDOW), false)
})

test('progress just under MIN does NOT reset the mark', () => {
  let s = recordProgress(makeWatchdogState(), 0, 0, 0, MIN)
  s = recordProgress(s, MIN - 1, 0, 30_000, MIN) // +1023 -> not enough
  assert.equal(s.markTime, 0) // mark unchanged
  assert.equal(isStalled(s, WINDOW, WINDOW), true)
})

test('done is sticky and ignores later samples', () => {
  let s = drive([[1000, 1000, 1000]])
  assert.equal(s.done, true)
  s = recordProgress(s, 1000, 1000, 99_999, MIN)
  assert.equal(s.done, true)
  assert.equal(isStalled(s, 9_999_999, WINDOW), false)
})
