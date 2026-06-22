import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyConsumedReadMarks,
  boundInboxMessages,
  resolveReadMarkIndex,
} from '../src/utils/inboxBound.mjs'

// A teammate message factory. `protected` marks a structured control message.
let seq = 0
function msg(over = {}) {
  seq += 1
  return {
    from: over.from ?? 'worker-1',
    text: over.text ?? `m${seq}`,
    timestamp: over.timestamp ?? `t${seq}`,
    read: over.read ?? false,
    ...over,
  }
}

// isProtected stub: a message whose text starts with 'CTRL:' is a control message
const isProtected = m => typeof m?.text === 'string' && m.text.startsWith('CTRL:')

const LIMITS = {
  isProtected,
  maxMessages: 5,
  maxTotalChars: 1_000_000,
  maxMessageChars: 20,
}

test('prune-read: read tombstones are dropped, unread kept in order', () => {
  const a = msg({ text: 'a', read: true })
  const b = msg({ text: 'b', read: false })
  const c = msg({ text: 'c', read: true })
  const d = msg({ text: 'd', read: false })
  const r = boundInboxMessages([a, b, c, d], LIMITS)
  assert.deepEqual(
    r.messages.map(m => m.text),
    ['b', 'd'],
  )
  assert.equal(r.prunedRead, 2)
  assert.equal(r.dropped.length, 0)
})

test('per-message truncation hits only oversized NON-protected text', () => {
  const big = 'x'.repeat(50)
  const r = boundInboxMessages(
    [msg({ text: big }), msg({ text: `CTRL:${big}` })],
    LIMITS,
  )
  assert.equal(r.truncatedCount, 1)
  assert.ok(r.messages[0].text.length <= 20 + 80) // 20 + marker
  assert.ok(r.messages[0].text.startsWith('x'.repeat(20)))
  // the protected control message is left byte-identical (its JSON must parse)
  assert.equal(r.messages[1].text, `CTRL:${big}`)
})

test('count cap evicts OLDEST non-protected, never the newest', () => {
  const ms = [
    msg({ text: 'm1' }),
    msg({ text: 'm2' }),
    msg({ text: 'm3' }),
    msg({ text: 'm4' }),
    msg({ text: 'm5' }),
    msg({ text: 'm6' }), // newest — 6 unread, cap 5 → drop 1 oldest
  ]
  const r = boundInboxMessages(ms, LIMITS)
  assert.equal(r.messages.length, 5)
  assert.equal(r.dropped.length, 1)
  assert.equal(r.dropped[0].text, 'm1') // oldest dropped
  assert.equal(r.messages.at(-1).text, 'm6') // newest kept
})

test('byte cap evicts oldest until under maxTotalChars', () => {
  const ms = [
    msg({ text: 'a'.repeat(100) }),
    msg({ text: 'b'.repeat(100) }),
    msg({ text: 'c'.repeat(100) }), // newest
  ]
  const r = boundInboxMessages(ms, {
    isProtected,
    maxMessages: 100,
    maxTotalChars: 250, // 3*100=300 > 250 → drop oldest 'a' → 200 <= 250
    maxMessageChars: 1000,
  })
  assert.equal(r.messages.length, 2)
  assert.equal(r.dropped[0].text, 'a'.repeat(100))
})

test('THE FIX: a forged-"protected" flood is still bounded (control evicted as last resort)', () => {
  // A peer forging control-typed plain bodies must NOT evade the cap. With all
  // messages "protected" and over the count cap, the OLDEST protected ones are
  // evicted (last resort), the newest is kept, and the cap is enforced.
  const ms = [
    msg({ text: 'CTRL:1' }),
    msg({ text: 'CTRL:2' }),
    msg({ text: 'CTRL:3' }),
    msg({ text: 'CTRL:4' }),
    msg({ text: 'CTRL:5' }),
    msg({ text: 'CTRL:6' }),
    msg({ text: 'CTRL:7' }), // 7 control msgs, cap 5
  ]
  const r = boundInboxMessages(ms, LIMITS)
  assert.equal(r.messages.length, 5) // bounded to the cap (NOT immune)
  assert.deepEqual(r.dropped.map(m => m.text), ['CTRL:1', 'CTRL:2']) // oldest 2 dropped
  assert.equal(r.messages.at(-1).text, 'CTRL:7') // newest always kept
})

test('non-protected are evicted BEFORE protected (control shed last)', () => {
  const ms = [
    msg({ text: 'CTRL:a' }),
    msg({ text: 'p1' }),
    msg({ text: 'CTRL:b' }),
    msg({ text: 'p2' }),
    msg({ text: 'p3' }),
    msg({ text: 'p4' }), // newest; 6 total, cap 5 → drop oldest non-protected = p1
  ]
  const r = boundInboxMessages(ms, LIMITS)
  assert.equal(r.messages.length, 5)
  assert.deepEqual(r.dropped.map(m => m.text), ['p1']) // a non-protected, not a CTRL
  assert.ok(r.messages.some(m => m.text === 'CTRL:a')) // both control kept
  assert.ok(r.messages.some(m => m.text === 'CTRL:b'))
  assert.equal(r.messages.at(-1).text, 'p4') // newest kept
})

test('byte-cap forged-protected flood is bounded too (oldest protected evicted)', () => {
  const big = 'z'.repeat(100)
  const ms = [
    msg({ text: `CTRL:${big}` }),
    msg({ text: `CTRL:${big}` }),
    msg({ text: `CTRL:${big}` }), // newest; 3 * ~105 = 315 chars
  ]
  const r = boundInboxMessages(ms, {
    isProtected,
    maxMessages: 100,
    maxTotalChars: 250, // 315 > 250 → must drop the oldest protected
    maxMessageChars: 1000,
  })
  assert.equal(r.dropped.length, 1)
  assert.equal(r.messages.length, 2)
  assert.equal(r.messages.at(-1), ms.at(-1)) // newest protected kept
})

test('under cap is a pass-through (no drops, no truncation)', () => {
  const ms = [msg({ text: 'a' }), msg({ text: 'b' })]
  const r = boundInboxMessages(ms, LIMITS)
  assert.equal(r.dropped.length, 0)
  assert.equal(r.truncatedCount, 0)
  assert.equal(r.prunedRead, 0)
  assert.equal(r.messages.length, 2)
})

test('non-array input fails closed', () => {
  const r = boundInboxMessages(null, LIMITS)
  assert.deepEqual(r.messages, [])
})

// ---- resolveReadMarkIndex ----

test('resolveReadMarkIndex: matching index returns it (fast path)', () => {
  const ms = [msg({ from: 'a', text: 'x', timestamp: 't1' })]
  assert.equal(
    resolveReadMarkIndex(ms, 0, { from: 'a', text: 'x', timestamp: 't1' }),
    0,
  )
})

test('resolveReadMarkIndex: a leading-prune shift re-finds by identity', () => {
  // reader saw [m0(read), A, B], picked index 1 (A); prune removed m0 → [A, B]
  const A = { from: 'a', text: 'A', timestamp: 't1', read: false }
  const B = { from: 'b', text: 'B', timestamp: 't2', read: false }
  const afterPrune = [A, B]
  // raw index 1 would wrongly point at B; identity re-finds A at index 0
  assert.equal(
    resolveReadMarkIndex(afterPrune, 1, { from: 'a', text: 'A', timestamp: 't1' }),
    0,
  )
})

test('resolveReadMarkIndex: already-read or pruned target → -1 (no-op)', () => {
  const ms = [{ from: 'a', text: 'A', timestamp: 't1', read: true }]
  assert.equal(
    resolveReadMarkIndex(ms, 0, { from: 'a', text: 'A', timestamp: 't1' }),
    -1,
  )
  assert.equal(
    resolveReadMarkIndex([], 0, { from: 'a', text: 'A', timestamp: 't1' }),
    -1,
  )
})

test('resolveReadMarkIndex: out-of-bounds index but identity present → re-find', () => {
  const ms = [{ from: 'a', text: 'A', timestamp: 't1', read: false }]
  assert.equal(
    resolveReadMarkIndex(ms, 9, { from: 'a', text: 'A', timestamp: 't1' }),
    0,
  )
})

test('resolveReadMarkIndex: duplicate identical content marks exactly one', () => {
  const dup = { from: 'a', text: 'A', timestamp: 't1', read: false }
  const ms = [{ ...dup }, { ...dup }]
  // a VALID supplied index is honored (marks the reader's actually-selected one)
  assert.equal(
    resolveReadMarkIndex(ms, 1, { from: 'a', text: 'A', timestamp: 't1' }),
    1,
  )
  // a STALE/out-of-range index re-finds the FIRST matching unread (still one)
  assert.equal(
    resolveReadMarkIndex(ms, 9, { from: 'a', text: 'A', timestamp: 't1' }),
    0,
  )
})

test('resolveReadMarkIndex: no identity match → -1', () => {
  const ms = [{ from: 'a', text: 'A', timestamp: 't1', read: false }]
  assert.equal(
    resolveReadMarkIndex(ms, 0, { from: 'z', text: 'Z', timestamp: 't9' }),
    -1,
  )
  assert.equal(resolveReadMarkIndex(ms, 0, undefined), -1)
})

// --- applyConsumedReadMarks: mark ONLY the consumed snapshot by identity ---

test('applyConsumedReadMarks THE FIX: a mid-poll arrival not in the snapshot stays unread', () => {
  const m1 = { from: 'lead', timestamp: 't1', text: 'task A', read: false }
  // m2 was appended by a concurrent writeToMailbox AFTER the poll snapshot
  const m2 = { from: 'lead', timestamp: 't2', text: 'task B', read: false }
  const consumed = [m1] // the poll only ever saw m1
  const out = applyConsumedReadMarks([m1, m2], consumed)
  assert.equal(out[0].read, true) // consumed → marked
  assert.equal(out[1].read, false) // mid-poll arrival → left unread (delivered next poll)
})

test('applyConsumedReadMarks marks every consumed message (steady state == old behaviour)', () => {
  const a = { from: 'w', timestamp: 't1', text: 'a', read: false }
  const b = { from: 'w', timestamp: 't2', text: 'b', read: false }
  const out = applyConsumedReadMarks([a, b], [a, b])
  assert.deepEqual(out.map(m => m.read), [true, true])
})

test('applyConsumedReadMarks duplicate identity: marks exactly as many as were consumed, oldest first', () => {
  // three unread copies of an identical (from,timestamp,text) triple in the file,
  // but only two were in the consumed snapshot → the 3rd (a mid-poll dup) survives
  const dup = () => ({ from: 'w', timestamp: 't1', text: 'dup', read: false })
  const file = [dup(), dup(), dup()]
  const consumed = [dup(), dup()]
  const out = applyConsumedReadMarks(file, consumed)
  assert.deepEqual(out.map(m => m.read), [true, true, false])
})

test('applyConsumedReadMarks does not re-mark or over-decrement already-read messages', () => {
  const read = { from: 'w', timestamp: 't1', text: 'x', read: true }
  const unread = { from: 'w', timestamp: 't1', text: 'x', read: false }
  // consumed names the identity once; the already-read copy must not consume the
  // count, so the unread copy still gets marked
  const out = applyConsumedReadMarks([read, unread], [unread])
  assert.equal(out[0].read, true)
  assert.equal(out[1].read, true)
})

test('applyConsumedReadMarks empty consumed marks nothing; refs preserved for unchanged', () => {
  const a = { from: 'w', timestamp: 't1', text: 'a', read: false }
  const out = applyConsumedReadMarks([a], [])
  assert.equal(out[0].read, false)
  assert.equal(out[0], a) // unchanged message returned by reference
})

test('applyConsumedReadMarks: a consumed message absent from the file is a no-op (evicted by bounding)', () => {
  const a = { from: 'w', timestamp: 't1', text: 'a', read: false }
  const gone = { from: 'w', timestamp: 't9', text: 'evicted', read: false }
  const out = applyConsumedReadMarks([a], [a, gone])
  assert.deepEqual(out.map(m => m.read), [true])
})

test('applyConsumedReadMarks returns a NEW array; only changed messages are fresh objects', () => {
  const a = { from: 'w', timestamp: 't1', text: 'a', read: false }
  const b = { from: 'w', timestamp: 't2', text: 'b', read: false }
  const input = [a, b]
  const out = applyConsumedReadMarks(input, [a])
  assert.notEqual(out, input) // a new array, not the input array
  assert.notEqual(out[0], a) // marked → fresh object
  assert.equal(out[1], b) // unchanged → same reference
  assert.equal(a.read, false) // input not mutated
})

test('applyConsumedReadMarks: non-array messages returned as-is; identity uses from+timestamp+text', () => {
  assert.equal(applyConsumedReadMarks(null, []), null)
  assert.equal(applyConsumedReadMarks(undefined, [{}]), undefined)
  // same text+timestamp but different sender → NOT the same message
  const x = { from: 'a', timestamp: 't1', text: 'hi', read: false }
  const y = { from: 'b', timestamp: 't1', text: 'hi', read: false }
  const out = applyConsumedReadMarks([x, y], [x])
  assert.deepEqual(out.map(m => m.read), [true, false])
})
