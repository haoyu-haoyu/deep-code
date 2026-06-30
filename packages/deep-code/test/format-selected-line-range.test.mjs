import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatSelectedLineRange } from '../src/utils/formatSelectedLineRange.mjs'

// The sibling diagnostics convention the IDE selection render must match.
const diagnosticLineLabel = zeroBasedLine => zeroBasedLine + 1

test('a multi-line selection is rendered 1-based on both ends (editor lines 10-12)', () => {
  // VS Code emits start.line=9, and the attachment derives lineEnd=11 (0-based) for
  // an editor selection the user sees as lines 10 to 12.
  assert.equal(formatSelectedLineRange(9, 11), '10 to 12')
})

test('a single-line selection (editor line 10)', () => {
  assert.equal(formatSelectedLineRange(9, 9), '10 to 10')
})

test('the first line of the file (0-based 0) renders as line 1, not 0', () => {
  assert.equal(formatSelectedLineRange(0, 0), '1 to 1')
})

test('matches the sibling diagnostics +1 convention exactly', () => {
  for (const [start, end] of [[0, 0], [9, 11], [41, 41], [100, 250]]) {
    const out = formatSelectedLineRange(start, end)
    assert.equal(out, `${diagnosticLineLabel(start)} to ${diagnosticLineLabel(end)}`)
  }
})
