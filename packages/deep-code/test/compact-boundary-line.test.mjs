import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  COMPACT_BOUNDARY_MARKER,
  parseCompactBoundaryLine,
} from '../src/utils/compactBoundaryLine.mjs'

// A real on-disk boundary line: parentUuid is serialized FIRST (recordTranscript
// puts it before the spread `...message` that carries type/subtype).
const realBoundary = (extra = '') =>
  `{"parentUuid":null,"logicalParentUuid":"u1","isSidechain":false,"type":"system","subtype":"compact_boundary"${extra},"uuid":"b1","timestamp":"2024-01-01T00:00:00.000Z"}`

test('THE bug: a parentUuid-first boundary line is detected (old `{"type":"system"` prefix gate missed it)', () => {
  const line = realBoundary()
  assert.ok(!line.startsWith('{"type":"system"'), 'precondition: line does NOT start with the old prefix')
  const hit = parseCompactBoundaryLine(line)
  assert.deepEqual(hit, { hasPreservedSegment: false })
})

test('a preservedSegment boundary reports hasPreservedSegment=true', () => {
  const hit = parseCompactBoundaryLine(realBoundary(',"compactMetadata":{"preservedSegment":{"tailUuid":"x"}}'))
  assert.deepEqual(hit, { hasPreservedSegment: true })
})

test('preservedSegment falsy/absent → hasPreservedSegment=false', () => {
  assert.equal(parseCompactBoundaryLine(realBoundary(',"compactMetadata":{}')).hasPreservedSegment, false)
  assert.equal(parseCompactBoundaryLine(realBoundary(',"compactMetadata":{"preservedSegment":null}')).hasPreservedSegment, false)
  assert.equal(parseCompactBoundaryLine(realBoundary(',"compactMetadata":{"preservedSegment":false}')).hasPreservedSegment, false)
})

test('seam split: joining the carry part + the post-seam part still detects (the straddle case)', () => {
  const line = realBoundary(',"compactMetadata":{"preservedSegment":{"tailUuid":"x"}}')
  for (const cut of [10, 30, line.indexOf('compact_boundary') - 2, line.indexOf('compact_boundary') + 5, line.length - 3]) {
    const joined = line.slice(0, cut) + line.slice(cut)
    assert.deepEqual(parseCompactBoundaryLine(joined), { hasPreservedSegment: true }, `cut at ${cut}`)
  }
})

test('a `{"type":"system"`-first variant is still detected (back-compat)', () => {
  const line = `{"type":"system","subtype":"compact_boundary","parentUuid":null,"uuid":"b"}`
  assert.deepEqual(parseCompactBoundaryLine(line), { hasPreservedSegment: false })
})

// --- re-validation: the marker can appear in user content ---

test('a non-boundary line that merely contains the marker substring is rejected', () => {
  // a user message whose text literally contains "compact_boundary"
  const line = `{"parentUuid":"p","type":"user","message":{"role":"user","content":"the \\"compact_boundary\\" marker"}}`
  assert.equal(parseCompactBoundaryLine(line), null)
})

test('a system line that is not a compact_boundary is rejected', () => {
  const line = `{"parentUuid":null,"type":"system","subtype":"something_else"}`
  assert.equal(parseCompactBoundaryLine(line), null)
})

test('a line without the marker fast-paths to null', () => {
  assert.equal(parseCompactBoundaryLine('{"parentUuid":"p","type":"assistant"}'), null)
  assert.equal(parseCompactBoundaryLine(''), null)
})

test('malformed JSON that contains the marker returns null (no throw)', () => {
  assert.equal(parseCompactBoundaryLine('{"type":"system","subtype":"compact_boundary"'), null) // truncated
  assert.equal(parseCompactBoundaryLine('garbage "compact_boundary" garbage'), null)
})

test('the marker constant is the exact JSON-quoted subtype token', () => {
  assert.equal(COMPACT_BOUNDARY_MARKER, '"compact_boundary"')
})
