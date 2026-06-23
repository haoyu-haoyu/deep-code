import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isNoNewlineMarker,
  stripNoNewlineMarkerLines,
} from '../src/utils/diffNoNewlineMarker.mjs'
import { numberDiffLines } from '../src/components/StructuredDiff/numberDiffLines.mjs'

// The hunk `lines` arrays below are exactly what the `diff` package's
// structuredPatch emits for a file lacking a trailing newline (the marker is
// inserted but NOT counted in the hunk's oldLines/newLines header).

// Verbatim port of Fallback.tsx transformLinesToObjects (the path under test).
function transformLinesToObjects(lines) {
  return lines.map(code => {
    if (code.startsWith('+')) {
      return { code: code.slice(1), i: 0, type: 'add', originalCode: code.slice(1) }
    }
    if (code.startsWith('-')) {
      return { code: code.slice(1), i: 0, type: 'remove', originalCode: code.slice(1) }
    }
    return { code: code.slice(1), i: 0, type: 'nochange', originalCode: code.slice(1) }
  })
}

test('isNoNewlineMarker: only a backslash-prefixed line is the marker', () => {
  assert.equal(isNoNewlineMarker('\\ No newline at end of file'), true)
  assert.equal(isNoNewlineMarker(' context'), false)
  assert.equal(isNoNewlineMarker('+added'), false)
  assert.equal(isNoNewlineMarker('-removed'), false)
  assert.equal(isNoNewlineMarker(''), false)
  // a context line whose CONTENT contains a backslash is NOT the marker
  assert.equal(isNoNewlineMarker(' path\\to\\file'), false)
})

test('stripNoNewlineMarkerLines returns the SAME reference when there is no marker', () => {
  const lines = [' a', '+b', '-c']
  assert.equal(stripNoNewlineMarkerLines(lines), lines) // identity, no alloc
})

test('THE FIX (trailing marker): the sentinel no longer becomes a phantom numbered line', () => {
  const lines = [
    ' function foo() {',
    '-  return 1',
    '+  return 2',
    ' }',
    '\\ No newline at end of file',
  ]
  // Old behavior: the marker is numbered as a context line 4 (beyond the 3-line file).
  const oldNumbered = numberDiffLines(transformLinesToObjects(lines), 1)
  assert.equal(oldNumbered.length, 5)
  assert.equal(oldNumbered[4].type, 'nochange')
  assert.equal(oldNumbered[4].i, 4) // the bug

  // New behavior: marker dropped before numbering.
  const newNumbered = numberDiffLines(
    transformLinesToObjects(stripNoNewlineMarkerLines(lines)),
    1,
  )
  assert.equal(newNumbered.length, 4)
  assert.ok(!newNumbered.some(l => l.code.includes('No newline at end of file')))
  assert.equal(newNumbered[3].code, '}')
  assert.equal(newNumbered[3].i, 3) // last real line is 3, no phantom line 4
})

test('THE FIX (mid-hunk marker): a + line after a sentinel is no longer mis-numbered', () => {
  // file `line1\nline2\nold` -> `line1\nline2\nnew`, both sides lack trailing newline
  const lines = [
    ' line1',
    ' line2',
    '-old',
    '\\ No newline at end of file',
    '+new',
    '\\ No newline at end of file',
  ]
  const oldNumbered = numberDiffLines(transformLinesToObjects(lines), 1)
  const oldNew = oldNumbered.find(l => l.code === 'new')
  assert.equal(oldNew.i, 4) // mislabeled (mid-hunk sentinel advanced the counter)

  const newNumbered = numberDiffLines(
    transformLinesToObjects(stripNoNewlineMarkerLines(lines)),
    1,
  )
  assert.ok(!newNumbered.some(l => l.code.includes('No newline at end of file')))
  const fixedNew = newNumbered.find(l => l.code === 'new')
  assert.equal(fixedNew.i, 3) // correct new-file line number
})
