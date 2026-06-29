import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isUnifiedDiffBodyLine } from '../src/utils/isUnifiedDiffBodyLine.mjs'

test('added / removed / context lines are body lines', () => {
  assert.equal(isUnifiedDiffBodyLine('+added'), true)
  assert.equal(isUnifiedDiffBodyLine('-removed'), true)
  assert.equal(isUnifiedDiffBodyLine('   indented context'), true)
})

test('a real blank context line (a single space) IS a body line', () => {
  // git renders an empty source line as ' ' (the space prefix), never ''. This
  // must keep qualifying so genuine blank lines stay in the hunk.
  assert.equal(isUnifiedDiffBodyLine(' '), true)
})

test("the trailing '' from splitting git's final newline is NOT a body line", () => {
  // This is the fix: '' was admitted before and became a phantom blank row.
  assert.equal(isUnifiedDiffBodyLine(''), false)
})

test('headers and markers are not body lines', () => {
  assert.equal(isUnifiedDiffBodyLine('@@ -1,3 +1,3 @@'), false)
  assert.equal(isUnifiedDiffBodyLine('\\ No newline at end of file'), false)
  assert.equal(isUnifiedDiffBodyLine('diff --git a/x b/x'), false)
  assert.equal(isUnifiedDiffBodyLine('index 0000..1111'), false)
  // A malformed line with no unified-diff prefix at all.
  assert.equal(isUnifiedDiffBodyLine('no prefix'), false)
})

test("scenario: a file-diff body split on '\\n' drops only the trailing artifact", () => {
  // parseGitDiff splits the file-diff on '\n'; git's trailing newline yields a
  // final '' element. Filtering the body lines through the classifier drops that
  // artifact and keeps the real lines.
  const body = [' header a', '-const x = 1', '+const x = 2', ' header b', '']
  const kept = body.filter(isUnifiedDiffBodyLine)
  assert.deepEqual(kept, [' header a', '-const x = 1', '+const x = 2', ' header b'])
  assert.equal(kept.includes(''), false)
})

test('scenario: a genuine blank context line is preserved while the trailing artifact is dropped', () => {
  const body = [' a', ' ', '-x', '+y', ' b', '']
  const kept = body.filter(isUnifiedDiffBodyLine)
  // the real ' ' blank context line stays; only the trailing '' is removed
  assert.deepEqual(kept, [' a', ' ', '-x', '+y', ' b'])
  assert.equal(kept.filter(l => l === '').length, 0)
  assert.equal(kept.filter(l => l === ' ').length, 1)
})
