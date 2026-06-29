import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recoverQuoteNormalizedEdit } from '../src/utils/recoverQuoteNormalizedEdit.mjs'
import { applySequentialEdits } from '../src/tools/FileEditTool/applySequentialEdits.mjs'

// Exact copies of src/tools/FileEditTool/utils.ts normalizeQuotes + findActualString,
// the on-disk match resolver. The .mjs layer cannot import the .ts module, so the
// resolver is injected; this mirrors it byte-for-byte.
function normalizeQuotes(str) {
  return str
    .replaceAll('‘', "'")
    .replaceAll('’', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
}
function findActualString(fileContent, searchString) {
  if (fileContent.includes(searchString)) return searchString
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  return null
}

const CURLY_OPEN = '“'
const CURLY_CLOSE = '”'

test('curly file + straight old_string: recovers the real curly substring', () => {
  const file = `greet(${CURLY_OPEN}hi${CURLY_CLOSE})\n`
  const edit = { old_string: 'greet("hi")', new_string: 'greet("bye")', replace_all: false }
  const recovered = recoverQuoteNormalizedEdit(file, edit, findActualString)
  assert.notEqual(recovered, null)
  assert.equal(recovered.old_string, `greet(${CURLY_OPEN}hi${CURLY_CLOSE})`)
  assert.equal(recovered.new_string, 'greet("bye")')
  // The recovered edit is exactly what the on-disk write applies.
  assert.equal(applySequentialEdits(file, [recovered]), 'greet("bye")\n')
})

test('reverse: straight file + curly old_string also recovers', () => {
  const file = 'x = "hi"\n'
  const edit = { old_string: `x = ${CURLY_OPEN}hi${CURLY_CLOSE}`, new_string: 'x = "bye"', replace_all: false }
  const recovered = recoverQuoteNormalizedEdit(file, edit, findActualString)
  assert.notEqual(recovered, null)
  assert.equal(recovered.old_string, 'x = "hi"')
  assert.equal(applySequentialEdits(file, [recovered]), 'x = "bye"\n')
})

test('exact raw match returns null (the raw scan already found it — not a recovery)', () => {
  const file = 'greet("hi")\n'
  const edit = { old_string: 'greet("hi")', new_string: 'greet("bye")', replace_all: false }
  assert.equal(recoverQuoteNormalizedEdit(file, edit, findActualString), null)
})

test('genuinely absent old_string returns null', () => {
  const file = 'something else\n'
  const edit = { old_string: 'not in file', new_string: 'x', replace_all: false }
  assert.equal(recoverQuoteNormalizedEdit(file, edit, findActualString), null)
})

test('empty old_string returns null (whole-file insert is the full-file branch)', () => {
  const file = 'anything\n'
  const edit = { old_string: '', new_string: 'x', replace_all: false }
  assert.equal(recoverQuoteNormalizedEdit(file, edit, findActualString), null)
})

test('new_string and replace_all pass through unchanged', () => {
  const file = `a ${CURLY_OPEN}b${CURLY_CLOSE} a ${CURLY_OPEN}b${CURLY_CLOSE}\n`
  const edit = { old_string: 'a "b"', new_string: 'Z', replace_all: true }
  const recovered = recoverQuoteNormalizedEdit(file, edit, findActualString)
  assert.notEqual(recovered, null)
  assert.equal(recovered.old_string, `a ${CURLY_OPEN}b${CURLY_CLOSE}`)
  assert.equal(recovered.new_string, 'Z')
  assert.equal(recovered.replace_all, true)
  // replace_all removes BOTH curly occurrences of the recovered `a "b"`, leaving
  // only the separating space — exactly what the on-disk replaceAll write does.
  assert.equal(applySequentialEdits(file, [recovered]), 'Z Z\n')
})

test('curly content-only delete recovers and composes with the delete write path', () => {
  const file = `${CURLY_OPEN}drop${CURLY_CLOSE}\nkeep\n`
  const edit = { old_string: '"drop"', new_string: '', replace_all: false }
  const recovered = recoverQuoteNormalizedEdit(file, edit, findActualString)
  assert.notEqual(recovered, null)
  assert.equal(recovered.old_string, `${CURLY_OPEN}drop${CURLY_CLOSE}`)
  // Content-only delete consumes the trailing newline (deleteOccurrences), so the
  // recovered edit yields the real on-disk removal, not a stranded blank line.
  assert.equal(applySequentialEdits(file, [recovered]), 'keep\n')
})

test('single curly quotes (apostrophes) recover too', () => {
  const file = "it’s here\n" // it’s
  const edit = { old_string: "it's here", new_string: "it's gone", replace_all: false }
  const recovered = recoverQuoteNormalizedEdit(file, edit, findActualString)
  assert.notEqual(recovered, null)
  assert.equal(recovered.old_string, "it’s here")
  assert.equal(applySequentialEdits(file, [recovered]), "it's gone\n")
})
