import assert from 'node:assert/strict'
import { test } from 'node:test'

import { notebookUnchangedDespiteMtime } from '../src/tools/NotebookEditTool/notebookStaleness.mjs'

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
