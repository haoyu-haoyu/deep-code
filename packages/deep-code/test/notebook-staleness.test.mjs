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

// REGRESSION (edit→touch→edit shape mismatch): the content NotebookEdit stores
// in readFileState after a write must be the PROCESSED cells JSON
// (jsonStringify(processNotebookCells(notebook)) — the exact shape FileReadTool
// stores and the fallback re-derives), NOT the raw notebook FILE JSON
// (jsonStringify(notebook, null, 1)) it writes to disk. If the raw form is
// stored, a later edit compares processed-cells (current) vs raw-notebook
// (stored) and the strings never match → spurious "modified since read".
test('a processed-cells stored shape engages; a raw-notebook stored shape does not', () => {
  // what processNotebookCells(...) + jsonStringify yields: a bare array of
  // processed cell views (cellType/source/cell_id, NOT cell_type/metadata/...).
  const processedCellsJson = JSON.stringify([
    {
      cellType: 'code',
      source: 'print(1)',
      cell_id: 'c1',
      language: 'python',
    },
  ])
  // what the OLD writeback stored: the whole notebook FILE object, indented.
  const rawNotebookJson = JSON.stringify(
    {
      cells: [
        {
          cell_type: 'code',
          id: 'c1',
          source: ['print(1)'],
          metadata: {},
          execution_count: null,
          outputs: [],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  )
  // the two shapes are genuinely different (so this is not a contrived equal)
  assert.notEqual(processedCellsJson, rawNotebookJson)
  // FIXED: edit stored processed cells → a later fallback (also processed) matches
  assert.equal(
    notebookUnchangedDespiteMtime(processedCellsJson, {
      content: processedCellsJson,
    }),
    true,
  )
  // BUG: edit stored the raw notebook → the processed re-derivation never matches
  assert.equal(
    notebookUnchangedDespiteMtime(processedCellsJson, {
      content: rawNotebookJson,
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

// a markdown cell that embeds an image carries an `attachments` map — a
// markdown/raw-only nbformat field the code-cell schema (additionalProperties:
// false) forbids. A markdown->code replace must DROP it or the notebook is
// nbformat-invalid (the #530 reconcile class, one field unhandled).
const mdCellWithAttachment = () => ({
  cell_type: 'markdown',
  id: 'm1',
  source: ['![](attachment:img.png)'],
  metadata: {},
  attachments: { 'img.png': { 'image/png': 'iVBOR...' } },
})

test('replace markdown->code drops the markdown-only attachments map', () => {
  const cell = applyReplacedCellShape(mdCellWithAttachment(), ['print(1)'], 'code')
  assert.equal(cell.cell_type, 'code')
  assert.ok(!('attachments' in cell), 'a code cell must not carry attachments')
  assert.equal(cell.execution_count, null)
  assert.deepEqual(cell.outputs, [])
})

test('a markdown-final replace PRESERVES a legitimate attachments map (legal on markdown)', () => {
  const cell = applyReplacedCellShape(mdCellWithAttachment(), ['![](attachment:img.png) edited'], 'markdown')
  assert.equal(cell.cell_type, 'markdown')
  assert.deepEqual(cell.attachments, { 'img.png': { 'image/png': 'iVBOR...' } })
  // and still no code-only fields leaked in
  assert.ok(!('execution_count' in cell) && !('outputs' in cell))
})
