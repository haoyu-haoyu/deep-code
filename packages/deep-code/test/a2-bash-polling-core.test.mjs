import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tailFileRaw } from '../src/utils/utf8Tail.mjs'
import { processTailRead, shouldSkipIdleTick } from '../src/utils/task/taskOutputPoll.mjs'

// ── Bash-output poller CORE (extracted from TaskOutput.#tick) ────────────────
// The existing a2/s1 tests assert these behaviors by STATIC source-pattern match
// or re-implement the algorithm independently. This file runs the ACTUAL shipped
// logic: the stale-callback generation guard, adaptive idle backoff, line
// counting/extrapolation, and byte-correct chunkDelta — including against a REAL
// growing file via the real tailFileRaw (the "real long-running Bash output" the
// test-audit flagged as never exercised).

const PROGRESS_TAIL_BYTES = 4096
const LAST = 10
const ALL = 100
const FRESH = {
  totalLines: 0,
  totalBytes: 0,
  lastSeenBytesTotal: 0,
  consecutiveEmptyTicks: 0,
  lastEmittedBytesTotal: 0,
}
const buf = s => Buffer.from(s, 'utf8')

function run(read, state = FRESH, { capturedGen = 1, currentGen = 1 } = {}) {
  return processTailRead({ read, capturedGen, currentGen, state, lastLinesCount: LAST, allLinesCount: ALL })
}

// --- shouldSkipIdleTick -----------------------------------------------------

test('shouldSkipIdleTick: skips only when idle AND on the parity-0 half', () => {
  assert.equal(shouldSkipIdleTick(5, 0, 5), true, 'idle + parity 0 -> skip')
  assert.equal(shouldSkipIdleTick(5, 1, 5), false, 'idle + parity 1 -> poll (every other tick)')
  assert.equal(shouldSkipIdleTick(4, 0, 5), false, 'below threshold -> always poll')
  assert.equal(shouldSkipIdleTick(0, 0, 5), false)
})

// --- the stale-callback generation guard ------------------------------------

test('processTailRead: a stale generation drops the read entirely (no state, no emit)', () => {
  const r = run({ buffer: buf('lots of new output\n'), bytesRead: 19, bytesTotal: 19 }, FRESH, {
    capturedGen: 1,
    currentGen: 2,
  })
  assert.deepEqual(r, { stale: true })
})

// --- adaptive idle backoff --------------------------------------------------

test('processTailRead: file growth resets the empty-tick counter; no growth increments it', () => {
  const grew = run({ buffer: buf('x\n'), bytesRead: 2, bytesTotal: 2 }, { ...FRESH, consecutiveEmptyTicks: 4, lastSeenBytesTotal: 0 })
  assert.equal(grew.state.consecutiveEmptyTicks, 0)
  assert.equal(grew.state.lastSeenBytesTotal, 2)

  // An empty tail (bytesRead===0) still emits, so the progress loop can check for
  // backgrounding. bytesRead===0 does NOT imply bytesTotal===0: a
  // truncation-during-read race can yield bytesRead 0 with bytesTotal>0 (stat saw
  // a size but the read got nothing). Use that realistic shape, with a STALE
  // prior totalBytes (999), to prove the empty path reports the read's bytesTotal
  // rather than leaking the stale value.
  const idle = run(
    { buffer: Buffer.alloc(0), bytesRead: 0, bytesTotal: 50 },
    { ...FRESH, totalBytes: 999, consecutiveEmptyTicks: 4, lastSeenBytesTotal: 50 },
  )
  assert.equal(idle.state.consecutiveEmptyTicks, 5) // bytesTotal == lastSeen -> no growth -> increment
  assert.equal(idle.progress.chunkDelta, '')
  assert.equal(idle.progress.lastLines, '')
  assert.equal(idle.progress.isIncomplete, false)
  // an empty tick must NOT advance the emit cursor or line count
  assert.equal(idle.state.lastEmittedBytesTotal, 0)
  assert.equal(idle.state.totalLines, 0)
  // state.totalBytes must track the read's bytesTotal (50), NOT lag at the stale
  // prior value (999), and must equal the emitted progress.totalBytes (no drift).
  assert.equal(idle.state.totalBytes, 50)
  assert.equal(idle.state.totalBytes, idle.progress.totalBytes)
})

// --- line counting + extrapolation ------------------------------------------

test('processTailRead: line count + last/all slices when the whole file fits the tail', () => {
  const text = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n') + '\n'
  const r = run({ buffer: buf(text), bytesRead: buf(text).length, bytesTotal: buf(text).length })
  // PRE-EXISTING behavior: the counter walks `lastIndexOf('\n')` and also counts
  // the empty segment after the FINAL newline, so a 12-line file ending in '\n'
  // reports 13 (newlines + 1). This is faithful to the shipped TaskOutput; the
  // trailing-segment over-count is a known cosmetic quirk, not changed here.
  assert.equal(r.progress.totalLines, 13)
  assert.equal(r.progress.isIncomplete, false)
  assert.equal(r.progress.lastLines, Array.from({ length: 9 }, (_, i) => `line${i + 3}`).join('\n') + '\n')
  assert.equal(r.progress.allLines, text)
})

test('processTailRead: extrapolates total lines from the tail sample, kept monotone', () => {
  // Tail holds 10 newline-terminated lines / 40 bytes; the file is 400 bytes.
  // lineCount of the tail is 11 (10 newlines + the trailing empty segment), so
  // the extrapolation is round((400/40) * 11) = 110.
  const tail = Array.from({ length: 10 }, () => 'abc').join('\n') + '\n' // 40 bytes
  const r = run({ buffer: buf(tail), bytesRead: 40, bytesTotal: 400 }, { ...FRESH, totalLines: 0 })
  assert.equal(r.progress.isIncomplete, true)
  assert.equal(r.progress.totalLines, 110)
  // monotone: a later tick with a longer-line tail must not regress the count
  const r2 = run({ buffer: buf(tail), bytesRead: 40, bytesTotal: 400 }, { ...FRESH, totalLines: 250 })
  assert.equal(r2.progress.totalLines, 250)
})

// --- byte-correct chunkDelta ------------------------------------------------

test('processTailRead: chunkDelta is the NEW bytes since the last emit', () => {
  // First emit: everything is new.
  const first = run({ buffer: buf('alpha\nbeta\n'), bytesRead: 11, bytesTotal: 11 })
  assert.equal(first.progress.chunkDelta, 'alpha\nbeta\n')
  assert.equal(first.state.lastEmittedBytesTotal, 11)
  // Second emit from the grown file: only the appended bytes.
  const second = run({ buffer: buf('alpha\nbeta\ngamma\n'), bytesRead: 17, bytesTotal: 17 }, { ...first.state })
  assert.equal(second.progress.chunkDelta, 'gamma\n')
})

test('processTailRead: undersampled growth hands back the full aligned tail', () => {
  // File grew by 1000 bytes but the tail only holds 10 — chunkDelta is the tail.
  const tail = 'tail-bytes\n'
  const r = run({ buffer: buf(tail), bytesRead: buf(tail).length, bytesTotal: 5000 }, { ...FRESH, lastEmittedBytesTotal: 4000 })
  assert.equal(r.progress.chunkDelta, tail)
  assert.equal(r.state.lastEmittedBytesTotal, 5000)
})

// --- REAL growing file via the real tailFileRaw -----------------------------

async function pollFile(path, state, gens) {
  const read = await tailFileRaw(path, PROGRESS_TAIL_BYTES)
  return processTailRead({ read, capturedGen: gens?.captured ?? 1, currentGen: gens?.current ?? 1, state, lastLinesCount: LAST, allLinesCount: ALL })
}

test('real growing file: consecutive ticks stream only the newly-appended bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bashpoll-'))
  const f = join(dir, 'out.txt')
  try {
    writeFileSync(f, 'line1\nline2\n')
    const r1 = await pollFile(f, { ...FRESH })
    assert.equal(r1.stale, false)
    assert.equal(r1.progress.chunkDelta, 'line1\nline2\n', 'first tick emits all bytes')
    assert.equal(r1.progress.totalLines, 3) // 2 newlines + trailing empty segment
    assert.equal(r1.progress.isIncomplete, false)

    assert.equal(r1.progress.lastLines, 'line1\nline2\n', 'first tick preview shows the whole small file')

    appendFileSync(f, 'line3\nline4\n') // a long command writes more
    const r2 = await pollFile(f, { ...r1.state })
    assert.equal(r2.progress.chunkDelta, 'line3\nline4\n', 'second tick emits ONLY the new bytes')
    assert.equal(r2.progress.totalLines, 5) // 4 newlines + trailing empty segment
    // the preview (lastLines) reflects the FULL accumulated tail, not just the delta
    assert.equal(r2.progress.lastLines, 'line1\nline2\nline3\nline4\n', 'preview shows the accumulated tail')

    // No growth -> empty tick, counter increments, cursor holds.
    const r3 = await pollFile(f, { ...r2.state })
    assert.equal(r3.progress.chunkDelta, '')
    assert.equal(r3.state.consecutiveEmptyTicks, 1)
    assert.equal(r3.state.lastEmittedBytesTotal, r2.state.lastEmittedBytesTotal)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('real growing file: a stale-generation tick is dropped (no regression to an older snapshot)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bashpoll-'))
  const f = join(dir, 'out.txt')
  try {
    writeFileSync(f, 'fresh output line\n')
    const r = await pollFile(f, { ...FRESH }, { captured: 1, current: 2 })
    assert.deepEqual(r, { stale: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('real growing file: multibyte UTF-8 straddling the tail-window start decodes without U+FFFD', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bashpoll-'))
  const f = join(dir, 'utf8.txt')
  try {
    // 1400 × "日" (3 bytes each = 4200) + newline > the 4096 tail window, so the
    // window starts ~byte 105 — inside a multibyte codepoint. The decoder must
    // realign to the next boundary instead of emitting replacement chars.
    writeFileSync(f, '日'.repeat(1400) + '\n')
    const r = await pollFile(f, { ...FRESH })
    assert.equal(r.stale, false)
    assert.equal(r.progress.isIncomplete, true, 'file is larger than the tail window')
    assert.doesNotMatch(r.progress.allLines, /�/, 'no replacement char from a mid-codepoint cut')
    assert.doesNotMatch(r.progress.chunkDelta, /�/)
    assert.ok(r.progress.allLines.includes('日'), 'the realigned tail still contains the multibyte content')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
