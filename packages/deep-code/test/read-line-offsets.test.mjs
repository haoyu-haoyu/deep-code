import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveReadLineOffsets } from '../src/tools/FileReadTool/readLineOffsets.mjs'

test('offset 0 (schema-allowed) reads from the first line and labels it line 1', () => {
  // The bug: startLine was `offset` (0), mislabelling the first line as "0".
  assert.deepEqual(resolveReadLineOffsets(0), { lineOffset: 0, startLine: 1 })
})

test('offset 1 (the default) is unchanged', () => {
  assert.deepEqual(resolveReadLineOffsets(1), { lineOffset: 0, startLine: 1 })
})

test('offset N >= 1 is unchanged: lineOffset = N-1, startLine = N', () => {
  for (const n of [2, 5, 42, 100, 1000]) {
    assert.deepEqual(resolveReadLineOffsets(n), {
      lineOffset: n - 1,
      startLine: n,
    })
  }
})

test('startLine is always lineOffset + 1 (the two indices can never drift)', () => {
  for (let offset = 0; offset <= 5000; offset++) {
    const { lineOffset, startLine } = resolveReadLineOffsets(offset)
    assert.equal(startLine, lineOffset + 1)
  }
})

test('startLine === offset for every offset >= 1 (byte-identical to the old label)', () => {
  // The EOF warning echoes data.file.startLine; for offset >= 1 it must remain
  // exactly `offset` so that warning text is unchanged.
  for (const offset of [1, 2, 7, 99, 100, 12345]) {
    assert.equal(resolveReadLineOffsets(offset).startLine, offset)
  }
})

test('lineOffset is byte-identical to the old `offset === 0 ? 0 : offset - 1`', () => {
  for (let offset = 0; offset <= 2000; offset++) {
    const expected = offset === 0 ? 0 : offset - 1
    assert.equal(resolveReadLineOffsets(offset).lineOffset, expected)
  }
})
