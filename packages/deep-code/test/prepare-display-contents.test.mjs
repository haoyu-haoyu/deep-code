import assert from 'node:assert/strict'
import { test } from 'node:test'

import { prepareDisplayContents } from '../src/utils/prepareDisplayContents.mjs'
import { applySequentialEdits } from '../src/tools/FileEditTool/applySequentialEdits.mjs'
import { escapeForDiff } from '../src/utils/escapeForDiff.mjs'

// Exact copy of src/utils/file.ts convertLeadingTabsToSpaces — the .mjs layer
// cannot import the .ts module, so it is injected.
function convertLeadingTabsToSpaces(content) {
  if (!content.includes('\t')) return content
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))
}

// The "after" content the on-disk write produces, escaped+tab-converted exactly
// as getPatchForDisplay renders it. prepareDisplayContents must reproduce this.
function diskPreparedNew(file, edits) {
  return escapeForDiff(convertLeadingTabsToSpaces(applySequentialEdits(file, edits)))
}

// What the OLD escaped-space reduce produced (the bug), for divergence controls.
function legacyPreparedNew(file, edits) {
  const prepared = escapeForDiff(convertLeadingTabsToSpaces(file))
  return edits.reduce((p, edit) => {
    const escOld = escapeForDiff(convertLeadingTabsToSpaces(edit.old_string))
    const escNew = escapeForDiff(convertLeadingTabsToSpaces(edit.new_string))
    const replaceAll = 'replace_all' in edit ? edit.replace_all : false
    return replaceAll
      ? p.replaceAll(escOld, () => escNew)
      : p.replace(escOld, () => escNew)
  }, prepared)
}

test('content-only delete: preview matches the on-disk removal, not a stranded blank line', () => {
  const file = 'a\nLINE\nb\n'
  const edits = [{ old_string: 'LINE', new_string: '', replace_all: false }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // disk = 'a\nb\n' (line removed). The legacy reduce left 'a\n\nb\n' (stranded blank).
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.notEqual(preparedNew, legacyPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('a\nb\n'))
})

test('mid-line substring delete: preview glues the lines exactly as the write does', () => {
  const file = 'aXb\nc\n'
  const edits = [{ old_string: 'Xb', new_string: '', replace_all: false }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // disk = 'ac\n' (lines glued); legacy showed 'a\nc\n' (two separate lines).
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('ac\n'))
  assert.notEqual(preparedNew, legacyPreparedNew(file, edits))
})

test('replace_all delete: every occurrence removed in the preview, none left as a blank', () => {
  const file = 'a\nX\nb\nX\nc\n'
  const edits = [{ old_string: 'X', new_string: '', replace_all: true }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('a\nb\nc\n'))
  assert.notEqual(preparedNew, legacyPreparedNew(file, edits))
})

test('leading-tab old_string matching a mid-line tab: preview shows the real change (not an empty diff)', () => {
  const file = 'const flag = true;\tconst secret = oldValue;\n'
  const edits = [
    { old_string: '\tconst secret = oldValue;', new_string: '\tconst secret = NEW;', replace_all: false },
  ]
  const { prepared, preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // disk applies on the RAW file (tab matches tab); legacy reduce missed (tab→spaces)
  // and produced an EMPTY diff (preparedNew === prepared).
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.notEqual(preparedNew, prepared) // a real change IS shown now
  assert.equal(legacyPreparedNew(file, edits), prepared) // the bug: legacy showed nothing
})

test('empty old_string on a whitespace-only file: preview replaces the whole file like the write', () => {
  const file = '  \n\n'
  const edits = [{ old_string: '', new_string: 'NEW CONTENT', replace_all: false }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // disk = 'NEW CONTENT' (whole replace); legacy prepended → 'NEW CONTENT  \n\n'.
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('NEW CONTENT'))
  assert.notEqual(preparedNew, legacyPreparedNew(file, edits))
})

test('ordinary non-empty replacement is unchanged (parity with the write)', () => {
  const file = 'a\nfoo\nb\n'
  const edits = [{ old_string: 'foo', new_string: 'bar', replace_all: false }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('a\nbar\nb\n'))
})

test('$-sequences in new_string are inserted literally (function replacer, no $& interpretation)', () => {
  const file = 'a\nfoo\nb\n'
  const edits = [{ old_string: 'foo', new_string: '$&bar', replace_all: false }]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // The write inserts '$&bar' verbatim; the preview must agree.
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('a\n$&bar\nb\n'))
})

test('multi-edit with a delete: preview composes exactly as the sequential write', () => {
  const file = 'function f() {\n  const debug = true;\n  return 1;\n}\n'
  const edits = [
    { old_string: 'return 1;', new_string: 'return 2;', replace_all: false },
    { old_string: '  const debug = true;\n', new_string: '', replace_all: false },
  ]
  const { preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  assert.equal(preparedNew, diskPreparedNew(file, edits))
  assert.equal(preparedNew, escapeForDiff('function f() {\n  return 2;\n}\n'))
})

test('unmatched old_string: falls back to the legacy reduce byte-identically (no throw leaks)', () => {
  const file = 'a\nb\n'
  const edits = [{ old_string: 'NOPE', new_string: 'X', replace_all: false }]
  let result
  assert.doesNotThrow(() => {
    result = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  })
  // applySequentialEdits throws "String not found" → fallback to the legacy reduce,
  // which here is a no-op, so the preview is an empty diff exactly as before.
  assert.equal(result.preparedNew, legacyPreparedNew(file, edits))
  assert.equal(result.preparedNew, result.prepared)
})

test('identity edit (old === new): no-op throw falls back to an empty preview', () => {
  const file = 'a\nfoo\nb\n'
  const edits = [{ old_string: 'foo', new_string: 'foo', replace_all: false }]
  const { prepared, preparedNew } = prepareDisplayContents(file, edits, convertLeadingTabsToSpaces)
  // applySequentialEdits throws on a no-op; legacy reduce also yields no change.
  assert.equal(preparedNew, prepared)
})
