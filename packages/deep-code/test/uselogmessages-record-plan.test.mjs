import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveRecordPlan } from '../src/hooks/recordPlan.mjs'

// The discriminator BEFORE this fix (append-only: first-uuid + length only),
// reconstructed for a differential. The fix adds the prefix-intact guard.
function oldPlan({
  wasFirstRender,
  currentFirstUuid,
  prevFirstUuid,
  prevLength,
  currentLength,
}) {
  const sameHead =
    currentFirstUuid !== undefined &&
    !wasFirstRender &&
    currentFirstUuid === prevFirstUuid
  const isIncremental = sameHead && prevLength <= currentLength
  const isSameHeadShrink = sameHead && prevLength > currentLength
  const startIndex = isIncremental ? prevLength : 0
  return { startIndex, isIncremental, isSameHeadShrink }
}

// --- decision matrix ---

test('pure append: stays incremental (tail uuid unchanged)', () => {
  const plan = resolveRecordPlan({
    wasFirstRender: false,
    currentFirstUuid: 'a',
    prevFirstUuid: 'a',
    prevLength: 5,
    currentLength: 8,
    uuidAtPrevTailIndex: 'tail',
    prevRecordedTailUuid: 'tail', // prefix [0,5) intact
  })
  assert.deepEqual(plan, { startIndex: 5, isIncremental: true, isSameHeadShrink: false })
})

test('fullscreen `from` rebuild (interior boundary insert, GROWS): demoted to a FULL record', () => {
  // messages[0] kept, array grew, but the boundary spliced at an interior index
  // shifted messages[prevLength-1] → tail uuid no longer matches → startIndex 0.
  for (const currentLength of [6, 9, 12]) {
    const plan = resolveRecordPlan({
      wasFirstRender: false,
      currentFirstUuid: 'a',
      prevFirstUuid: 'a',
      prevLength: 5,
      currentLength,
      uuidAtPrevTailIndex: 'B_new_shifted', // the interior insert shifted the tail
      prevRecordedTailUuid: 'tail',
    })
    assert.deepEqual(
      plan,
      { startIndex: 0, isIncremental: false, isSameHeadShrink: false },
      `currentLength=${currentLength}`,
    )
  }
})

test('ephemeral same-length tail replacement stays incremental (no transcript-bloat regression)', () => {
  // REPL.tsx replaces the last message with a new-uuid progress tick at the SAME
  // length. The old code short-circuited (startIndex === length → no write); the
  // guard must NOT demote this to a full record (else per-second sleep/bash ticks
  // flood the transcript). A changed tail uuid at SAME length stays incremental.
  const plan = resolveRecordPlan({
    wasFirstRender: false,
    currentFirstUuid: 'a',
    prevFirstUuid: 'a',
    prevLength: 5,
    currentLength: 5, // same length
    uuidAtPrevTailIndex: 'new_tick_uuid', // tail swapped to a fresh-uuid tick
    prevRecordedTailUuid: 'old_tick_uuid',
  })
  // startIndex === currentLength → the hook early-returns and records nothing.
  assert.deepEqual(plan, { startIndex: 5, isIncremental: true, isSameHeadShrink: false })
})

test('boundary appended at the END (rawIdx === prevLength): stays incremental', () => {
  // The boundary lands at index prevLength, so messages[prevLength-1] is the old
  // tail (unchanged) and the boundary is already inside the tail slice.
  const plan = resolveRecordPlan({
    wasFirstRender: false,
    currentFirstUuid: 'a',
    prevFirstUuid: 'a',
    prevLength: 5,
    currentLength: 7,
    uuidAtPrevTailIndex: 'tail',
    prevRecordedTailUuid: 'tail',
  })
  assert.deepEqual(plan, { startIndex: 5, isIncremental: true, isSameHeadShrink: false })
})

test('first render: full record', () => {
  const plan = resolveRecordPlan({
    wasFirstRender: true,
    currentFirstUuid: 'a',
    prevFirstUuid: undefined,
    prevLength: 0,
    currentLength: 4,
    uuidAtPrevTailIndex: undefined,
    prevRecordedTailUuid: undefined,
  })
  assert.deepEqual(plan, { startIndex: 0, isIncremental: false, isSameHeadShrink: false })
})

test('same-head shrink: isSameHeadShrink, full record', () => {
  const plan = resolveRecordPlan({
    wasFirstRender: false,
    currentFirstUuid: 'a',
    prevFirstUuid: 'a',
    prevLength: 8,
    currentLength: 5,
    uuidAtPrevTailIndex: undefined, // out of bounds on shrink — irrelevant
    prevRecordedTailUuid: 'tail',
  })
  assert.deepEqual(plan, { startIndex: 0, isIncremental: false, isSameHeadShrink: true })
})

test('compaction (first uuid changed): full record, not incremental', () => {
  const plan = resolveRecordPlan({
    wasFirstRender: false,
    currentFirstUuid: 'NEW_BOUNDARY',
    prevFirstUuid: 'a',
    prevLength: 5,
    currentLength: 9,
    uuidAtPrevTailIndex: 'whatever',
    prevRecordedTailUuid: 'tail',
  })
  assert.deepEqual(plan, { startIndex: 0, isIncremental: false, isSameHeadShrink: false })
})

// --- differential: identical to the old plan EXCEPT the prefix-rewrite case ---

test('DIFFERENTIAL: matches the old discriminator except the interior-rewrite grow', () => {
  let s = 0x6d5a3c1b >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  const uuids = ['a', 'b', undefined]
  let divergences = 0
  for (let iter = 0; iter < 100000; iter++) {
    const wasFirstRender = rnd() < 0.2
    const currentFirstUuid = uuids[(rnd() * uuids.length) | 0]
    const prevFirstUuid = uuids[(rnd() * uuids.length) | 0]
    const prevLength = (rnd() * 10) | 0
    const currentLength = (rnd() * 10) | 0
    const uuidAtPrevTailIndex = uuids[(rnd() * uuids.length) | 0]
    const prevRecordedTailUuid = uuids[(rnd() * uuids.length) | 0]
    const input = {
      wasFirstRender,
      currentFirstUuid,
      prevFirstUuid,
      prevLength,
      currentLength,
      uuidAtPrevTailIndex,
      prevRecordedTailUuid,
    }
    const next = resolveRecordPlan(input)
    const prev = oldPlan(input)

    const sameHead =
      currentFirstUuid !== undefined && !wasFirstRender && currentFirstUuid === prevFirstUuid
    const strictGrow = prevLength < currentLength // same-length stays incremental
    const prefixIntact = uuidAtPrevTailIndex === prevRecordedTailUuid
    const isRewriteGrow = sameHead && strictGrow && !prefixIntact

    if (isRewriteGrow) {
      divergences++
      // the fix: old said incremental tail-append, new forces a full rebuild
      assert.deepEqual(prev, { startIndex: prevLength, isIncremental: true, isSameHeadShrink: false })
      assert.deepEqual(next, { startIndex: 0, isIncremental: false, isSameHeadShrink: false })
    } else {
      assert.deepEqual(next, prev, `unexpected divergence at ${JSON.stringify(input)}`)
    }
  }
  assert.ok(divergences > 0, 'the fuzz must exercise the rewrite-grow divergence at least once')
})
