import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveNotebookCellIndex } from '../src/tools/NotebookEditTool/resolveNotebookCellIndex.mjs'

// A stand-in for the real parseCellId: maps "cell-N" -> N, else undefined.
const parseCellId = id => {
  const m = /^cell-(\d+)$/.exec(id)
  return m ? Number(m[1]) : undefined
}

const cells = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('resolves by the literal cell id', () => {
  assert.equal(resolveNotebookCellIndex(cells, 'b', parseCellId), 1)
  assert.equal(resolveNotebookCellIndex(cells, 'a', parseCellId), 0)
})

test('falls back to the cell-N positional form', () => {
  assert.equal(resolveNotebookCellIndex(cells, 'cell-2', parseCellId), 2)
})

test('THE FIX: an unresolvable id returns -1 (so the caller can reject it)', () => {
  // Not a real id and not a cell-N index.
  assert.equal(resolveNotebookCellIndex(cells, 'nonexistent', parseCellId), -1)
  assert.equal(resolveNotebookCellIndex(cells, 'my-cell-id', parseCellId), -1)
})

test('an empty notebook with an unresolvable id returns -1', () => {
  assert.equal(resolveNotebookCellIndex([], 'a', parseCellId), -1)
})

test('a literal id is tried before the positional form', () => {
  // A cell whose literal id happens to be "cell-9" wins over the numeric parse.
  const odd = [{ id: 'x' }, { id: 'cell-9' }]
  assert.equal(resolveNotebookCellIndex(odd, 'cell-9', parseCellId), 1)
})

test('duplicate ids resolve to the first match', () => {
  const dup = [{ id: 'a' }, { id: 'dup' }, { id: 'dup' }]
  assert.equal(resolveNotebookCellIndex(dup, 'dup', parseCellId), 1)
})

test('an out-of-range cell-N is returned as-is (the past-end handling is preserved, not forced to -1)', () => {
  // The caller keeps its existing replace->insert/clamp handling for this; the
  // fix only changes the truly-unresolvable (-1) case.
  assert.equal(resolveNotebookCellIndex(cells, 'cell-9', parseCellId), 9)
})
