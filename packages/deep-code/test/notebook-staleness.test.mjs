import assert from 'node:assert/strict'
import { test } from 'node:test'

import { notebookUnchangedDespiteMtime } from '../src/tools/NotebookEditTool/notebookStaleness.mjs'
import { applyReplacedCellShape } from '../src/tools/NotebookEditTool/notebookCellShape.mjs'

// The .ts wiring re-derives `currentCellsJson` via jsonStringify(readNotebook(path))
// — exactly how FileReadTool produced readState.content — and passes both here.
// These tests lock in the pure decision that lets NotebookEditTool mirror
// FileEditTool's content-equality fallback (a bare mtime bump is a false positive).
//
// Gate is `!isPartialView`, NOT offset/limit: a notebook read always captures the
// whole notebook, so its stored content is full-fidelity even when the default
// offset=1 was stored. Only an injected/partial view (isPartialView) is distrusted.

test('byte-identical cells → unchanged (mtime bump is a false positive)', () => {
  assert.equal(
    notebookUnchangedDespiteMtime('[{"cell":1}]', { content: '[{"cell":1}]' }),
    true,
  )
})

test('a normal Read-originated state (offset=1) still engages — the whole point', () => {
  // FileReadTool stores offset=1 for a notebook Read, but the content is the
  // complete notebook. The fallback MUST trust it (this is the common
  // Read→touch→edit case an offset===undefined gate would have wrongly skipped).
  assert.equal(
    notebookUnchangedDespiteMtime('[{"cell":1}]', {
      content: '[{"cell":1}]',
      offset: 1,
      limit: undefined,
    }),
    true,
  )
})

test('an Edit-originated state (offset=undefined) engages too', () => {
  assert.equal(
    notebookUnchangedDespiteMtime('[{"cell":1}]', {
      content: '[{"cell":1}]',
      offset: undefined,
      limit: undefined,
    }),
    true,
  )
})

test('differing cells → changed (a real external edit)', () => {
  assert.equal(
    notebookUnchangedDespiteMtime('[{"cell":2}]', { content: '[{"cell":1}]' }),
    false,
  )
})

test('a one-character difference is detected as changed', () => {
  assert.equal(
    notebookUnchangedDespiteMtime('[{"source":"a"}]', { content: '[{"source":"b"}]' }),
    false,
  )
})

test('an injected/partial view (isPartialView) is never trusted', () => {
  // Memory-file attachments whose content differs from disk are flagged
  // isPartialView; the stored content isn't the on-disk notebook, so even a
  // byte match must not let the edit through — mirror FileWriteTool.
  assert.equal(
    notebookUnchangedDespiteMtime('[{"cell":1}]', {
      content: '[{"cell":1}]',
      isPartialView: true,
    }),
    false,
  )
})

test('missing read state → not unchanged (fail safe)', () => {
  assert.equal(notebookUnchangedDespiteMtime('X', undefined), false)
  assert.equal(notebookUnchangedDespiteMtime('X', null), false)
})

test('degenerate equal empty contents compare equal (pure string identity)', () => {
  assert.equal(notebookUnchangedDespiteMtime('', { content: '' }), true)
})

// --- applyReplacedCellShape: a type-changing replace stays nbformat-valid (F2) ---

const codeCell = () => ({
  cell_type: 'code',
  id: 'c1',
  source: ['old'],
  metadata: { tags: ['x'] },
  execution_count: 7,
  outputs: [{ output_type: 'stream', text: 'hi' }],
})
const mdCell = () => ({
  cell_type: 'markdown',
  id: 'm1',
  source: ['# old'],
  metadata: {},
})

test('replace code->markdown drops the code-only fields (execution_count/outputs)', () => {
  const cell = applyReplacedCellShape(codeCell(), ['# new'], 'markdown')
  assert.equal(cell.cell_type, 'markdown')
  assert.deepEqual(cell.source, ['# new'])
  assert.ok(!('execution_count' in cell), 'markdown cell must not carry execution_count')
  assert.ok(!('outputs' in cell), 'markdown cell must not carry outputs')
  assert.deepEqual(cell.metadata, { tags: ['x'] }) // metadata/id preserved
  assert.equal(cell.id, 'c1')
})

test('replace markdown->code adds the required code fields (reset)', () => {
  const cell = applyReplacedCellShape(mdCell(), ['print(1)'], 'code')
  assert.equal(cell.cell_type, 'code')
  assert.equal(cell.execution_count, null)
  assert.deepEqual(cell.outputs, [])
  assert.deepEqual(cell.source, ['print(1)'])
})

test('replace with no type change is the prior behavior (code resets, markdown untouched)', () => {
  const c = applyReplacedCellShape(codeCell(), ['new'], undefined)
  assert.equal(c.cell_type, 'code')
  assert.equal(c.execution_count, null)
  assert.deepEqual(c.outputs, [])

  const m = applyReplacedCellShape(mdCell(), ['# new'], undefined)
  assert.equal(m.cell_type, 'markdown')
  assert.ok(!('execution_count' in m) && !('outputs' in m))
})

test('a same-type replace passing the same cell_type behaves like no type change', () => {
  const c = applyReplacedCellShape(codeCell(), ['x'], 'code')
  assert.equal(c.cell_type, 'code')
  assert.equal(c.execution_count, null)
  assert.deepEqual(c.outputs, [])
})
