import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectResumeLeaf } from '../src/utils/sessionResumeLeaf.mjs'

const msg = (uuid, timestamp, type, extra = {}) => ({
  uuid,
  timestamp,
  type,
  isSidechain: false,
  ...extra,
})

// --- the bug: a later system/attachment entry must NOT outrank a user/assistant leaf ---

test('a trailing system/attachment entry does not become the resume anchor', () => {
  const messages = [
    msg('u1', '2024-01-01T00:00:01Z', 'user'),
    msg('a1', '2024-01-01T00:00:02Z', 'assistant'),
    // a later non-sidechain system entry (admitted by the raw `!isSidechain` pick)
    msg('s1', '2024-01-01T00:00:03Z', 'system'),
  ]
  const leafUuids = new Set(['a1', 's1']) // a1 is the real conversation leaf
  const leaf = selectResumeLeaf(messages.values(), leafUuids)
  assert.equal(leaf.uuid, 'a1') // NOT s1, even though s1 has the latest timestamp
})

test('an interior (non-leaf) node with the latest timestamp is not chosen', () => {
  const messages = [
    msg('u1', '2024-01-01T00:00:05Z', 'user'), // latest, but NOT a leaf
    msg('a1', '2024-01-01T00:00:02Z', 'assistant'), // the actual leaf
  ]
  const leafUuids = new Set(['a1'])
  assert.equal(selectResumeLeaf(messages, leafUuids).uuid, 'a1')
})

// --- common case: identical to the raw pick when the tip IS a user/assistant leaf ---

test('the latest user/assistant leaf is chosen (common case, byte-identical to old)', () => {
  const messages = [
    msg('u1', '2024-01-01T00:00:01Z', 'user'),
    msg('a1', '2024-01-01T00:00:09Z', 'assistant'),
  ]
  assert.equal(selectResumeLeaf(messages, new Set(['u1', 'a1'])).uuid, 'a1')
})

test('sidechain messages are never chosen', () => {
  const messages = [
    msg('a1', '2024-01-01T00:00:01Z', 'assistant'),
    msg('side', '2024-01-01T00:00:09Z', 'assistant', { isSidechain: true }),
  ]
  assert.equal(selectResumeLeaf(messages, new Set(['a1', 'side'])).uuid, 'a1')
})

// --- fallback: no qualifying leaf → latest non-sidechain (preserves old behavior) ---

test('falls back to the latest non-sidechain message when no user/assistant leaf exists', () => {
  const messages = [
    msg('s1', '2024-01-01T00:00:01Z', 'system'),
    msg('s2', '2024-01-01T00:00:09Z', 'system'),
  ]
  // leafUuids has no user/assistant member → rule finds nothing → fallback
  const leaf = selectResumeLeaf(messages, new Set(['s1', 's2']))
  assert.equal(leaf.uuid, 's2') // latest non-sidechain
})

test('returns undefined when there is nothing non-sidechain', () => {
  const messages = [msg('side', '2024-01-01T00:00:01Z', 'assistant', { isSidechain: true })]
  assert.equal(selectResumeLeaf(messages, new Set(['side'])), undefined)
})

// --- iterator input (Map.values()) is consumed correctly despite the double scan ---

test('accepts a one-shot iterator (rule + fallback both see the data)', () => {
  const map = new Map([
    ['s1', msg('s1', '2024-01-01T00:00:09Z', 'system')],
    ['a1', msg('a1', '2024-01-01T00:00:02Z', 'assistant')],
  ])
  // only s1 is a leaf (no user/assistant leaf) → must fall back, and the
  // fallback must still see the iterator's contents (materialized once).
  assert.equal(selectResumeLeaf(map.values(), new Set(['s1'])).uuid, 's1')
  // with a1 as the leaf, the rule picks it over the later system entry
  assert.equal(selectResumeLeaf(map.values(), new Set(['a1'])).uuid, 'a1')
})

test('a timestamp tie keeps the first-iterated message (matches findLatestMessage >)', () => {
  const messages = [
    msg('a1', '2024-01-01T00:00:05Z', 'assistant'),
    msg('a2', '2024-01-01T00:00:05Z', 'assistant'),
  ]
  assert.equal(selectResumeLeaf(messages, new Set(['a1', 'a2'])).uuid, 'a1')
})
