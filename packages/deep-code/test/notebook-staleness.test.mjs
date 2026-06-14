import assert from 'node:assert/strict'
import { test } from 'node:test'

import { notebookUnchangedDespiteMtime } from '../src/tools/NotebookEditTool/notebookStaleness.mjs'

// The .ts wiring re-derives `currentCellsJson` via jsonStringify(readNotebook(path))
// — exactly how FileReadTool produced readState.content — and passes both here.
// These tests lock in the pure decision that lets NotebookEditTool mirror
// FileEditTool's content-equality fallback (a bare mtime bump is a false positive).

const full = content => ({ content, offset: undefined, limit: undefined })

test('full read with byte-identical cells → unchanged (mtime bump is a false positive)', () => {
  assert.equal(notebookUnchangedDespiteMtime('[{"cell":1}]', full('[{"cell":1}]')), true)
})

test('full read with differing cells → changed (a real external edit)', () => {
  assert.equal(notebookUnchangedDespiteMtime('[{"cell":2}]', full('[{"cell":1}]')), false)
})

test('a one-character difference is detected as changed', () => {
  assert.equal(
    notebookUnchangedDespiteMtime('[{"source":"a"}]', full('[{"source":"b"}]')),
    false,
  )
})

test('partial/ranged read is never trusted for content equality', () => {
  // Even byte-identical, a ranged read's stored content is not the whole
  // notebook, so it cannot prove the rest is unchanged — match FileEditTool.
  assert.equal(
    notebookUnchangedDespiteMtime('X', { content: 'X', offset: 5, limit: undefined }),
    false,
  )
  assert.equal(
    notebookUnchangedDespiteMtime('X', { content: 'X', offset: undefined, limit: 10 }),
    false,
  )
  assert.equal(
    notebookUnchangedDespiteMtime('X', { content: 'X', offset: 0, limit: 100 }),
    false,
  )
})

test('missing read state → not unchanged (fail safe)', () => {
  assert.equal(notebookUnchangedDespiteMtime('X', undefined), false)
  assert.equal(notebookUnchangedDespiteMtime('X', null), false)
})

test('degenerate equal empty contents compare equal (pure string identity, no special-casing)', () => {
  assert.equal(notebookUnchangedDespiteMtime('', full('')), true)
})
