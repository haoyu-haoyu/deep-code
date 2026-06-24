import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applySequentialEdits } from '../src/tools/FileEditTool/applySequentialEdits.mjs'
import { applyEditToFile } from '../src/tools/FileEditTool/applyEditToFile.mjs'

// The pre-fix overlap check, ported verbatim as a differential oracle: it
// stripped trailing newlines from old_string before the substring test.
function oldApply(fileContents, edits, applyEdit = applyEditToFile) {
  let updatedFile = fileContents
  const appliedNewStrings = []
  for (const edit of edits) {
    const oldStringToCheck = edit.old_string.replace(/\n+$/, '')
    for (const previousNewString of appliedNewStrings) {
      if (oldStringToCheck !== '' && previousNewString.includes(oldStringToCheck)) {
        throw new Error(
          'Cannot edit file: old_string is a substring of a new_string from a previous edit.',
        )
      }
    }
    const previousContent = updatedFile
    updatedFile =
      edit.old_string === ''
        ? edit.new_string
        : applyEdit(updatedFile, edit.old_string, edit.new_string, edit.replace_all)
    if (updatedFile === previousContent) {
      throw new Error('String not found in file. Failed to apply edit.')
    }
    appliedNewStrings.push(edit.new_string)
  }
  if (updatedFile === fileContents) {
    throw new Error('Original and edited file match exactly. Failed to apply edit.')
  }
  return updatedFile
}

function outcome(fn) {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

test('THE FIX: trailing-newline old_string matching the original file is no longer falsely rejected', () => {
  // file "A\nS\n": edit1 inserts "xSy" (which contains "S"); edit2 replaces the
  // ORIGINAL second line "S\n". The pre-fix code stripped "S\n"->"S", saw "S" in
  // "xSy", and threw. The exact "S\n" only matches the original line, so the
  // edits are unambiguous.
  const file = 'A\nS\n'
  const edits = [
    { old_string: 'A', new_string: 'xSy', replace_all: false },
    { old_string: 'S\n', new_string: 'Z', replace_all: false },
  ]
  // old code: false-positive rejection
  const before = outcome(() => oldApply(file, edits))
  assert.equal(before.ok, false)
  assert.match(before.error, /substring of a new_string/)
  // new code: applies cleanly
  assert.equal(applySequentialEdits(file, edits), 'xSy\nZ')
})

test('genuine ambiguity is STILL caught (later old_string fully inside an earlier insert)', () => {
  const file = 'A'
  const edits = [
    { old_string: 'A', new_string: 'hello', replace_all: false },
    { old_string: 'hello', new_string: 'world', replace_all: false },
  ]
  assert.throws(
    () => applySequentialEdits(file, edits),
    /substring of a new_string/,
  )
})

test('genuine ambiguity with a trailing-newline old_string fully inside an insert is STILL caught', () => {
  // edit1 inserts "xQ\ny" which CONTAINS the full "Q\n"; edit2's "Q\n" is
  // therefore ambiguous (could match the inserted copy) — must still throw.
  const file = 'a\nQ\n'
  const edits = [
    { old_string: 'a', new_string: 'xQ\ny', replace_all: false },
    { old_string: 'Q\n', new_string: 'Z', replace_all: false },
  ]
  assert.throws(
    () => applySequentialEdits(file, edits),
    /substring of a new_string/,
  )
})

test('REGRESSION GUARD: a whole-newline old_string keeps its exact pre-fix behavior (no NEW throw)', () => {
  // file "line1\nline2"; edit1 inserts "A\nB" (which contains "\n"); edit2
  // replaces a single "\n". The gate strips "\n" -> "" so the ambiguity check is
  // skipped — exactly as before. The fix must NOT start throwing here.
  const file = 'line1\nline2'
  const edits = [
    { old_string: 'line1', new_string: 'A\nB', replace_all: false },
    { old_string: '\n', new_string: ' ', replace_all: false },
  ]
  const oldOut = outcome(() => oldApply(file, edits))
  const newOut = outcome(() => applySequentialEdits(file, edits))
  assert.equal(oldOut.ok, true, 'pre-fix code applied this cleanly')
  assert.deepEqual(newOut, oldOut, 'fix must preserve whole-newline behavior exactly')
  assert.equal(newOut.value, 'A B\nline2')
})

test('a multi-newline old_string ("\\n\\n") is likewise unaffected by the fix', () => {
  const file = 'p1\n\np2'
  const edits = [
    { old_string: 'p1', new_string: 'X\n\nY', replace_all: false }, // inserts "\n\n"
    { old_string: '\n\n', new_string: ' ', replace_all: false },
  ]
  assert.deepEqual(
    outcome(() => applySequentialEdits(file, edits)),
    outcome(() => oldApply(file, edits)),
  )
})

test('EQUIVALENCE: old_strings without trailing newlines behave exactly as before', () => {
  const cases = [
    { file: 'foo bar', edits: [{ old_string: 'foo', new_string: 'X' }, { old_string: 'bar', new_string: 'Y' }] },
    { file: 'one two three', edits: [{ old_string: 'two', new_string: 'TWO' }, { old_string: 'three', new_string: 'THREE' }] },
    { file: 'abc', edits: [{ old_string: 'zzz', new_string: 'q' }] }, // not found
    { file: 'aXbXc', edits: [{ old_string: 'X', new_string: 'Y', replace_all: true }] },
    { file: 'hello', edits: [{ old_string: 'hello', new_string: 'hi' }, { old_string: 'hi', new_string: 'hey' }] }, // ambiguous
  ]
  for (const { file, edits } of cases) {
    const oldOut = outcome(() => oldApply(file, edits))
    const newOut = outcome(() => applySequentialEdits(file, edits))
    assert.deepEqual(newOut, oldOut, `divergence for ${JSON.stringify({ file, edits })}`)
  }
})

test('new code only ever REMOVES false-positive throws — never a result the old code allowed differs', () => {
  // For any case the OLD code applied successfully, the NEW code applies it to
  // the identical result (the guard only got narrower). Differential over a few
  // multi-edit shapes that the old code accepted.
  const accepted = [
    { file: 'a\nb\nc\n', edits: [{ old_string: 'a\n', new_string: 'A\n' }, { old_string: 'c\n', new_string: 'C\n' }] },
    { file: 'name = old', edits: [{ old_string: 'old', new_string: 'new' }] },
  ]
  for (const { file, edits } of accepted) {
    const oldOut = outcome(() => oldApply(file, edits))
    if (!oldOut.ok) continue
    assert.equal(applySequentialEdits(file, edits), oldOut.value)
  }
})

test('"String not found" is thrown when an old_string is absent', () => {
  assert.throws(
    () => applySequentialEdits('abc', [{ old_string: 'zzz', new_string: 'q' }]),
    /String not found in file/,
  )
})

test('an injected applyEdit receives the FULL old_string (newlines intact), not a stripped one', () => {
  const seen = []
  const spyApply = (file, oldStr, newStr) => {
    seen.push(oldStr)
    return file.replace(oldStr, newStr)
  }
  applySequentialEdits('x\ny\n', [{ old_string: 'x\n', new_string: 'X\n' }], spyApply)
  assert.deepEqual(seen, ['x\n']) // exact old_string, trailing newline preserved
})
