import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFileCompletion } from '../src/hooks/buildFileCompletion.mjs'

// The exact pre-fix dropdown-refresh string + offset, as a differential oracle.
function oldRefresh(input, token, replacement) {
  return { searchString: input.replace(token, replacement), cursor: null }
}

test('single token: splices the replacement at startPos and reports end cursor', () => {
  // input "@co", token "@co" at startPos 0, extending to "@core/"
  const { newInput, cursorPos } = buildFileCompletion('@co', '@core/', 0, 3)
  assert.equal(newInput, '@core/')
  assert.equal(cursorPos, 6)
})

test('THE FIX: a duplicate earlier token is NOT mis-targeted (positional, not first-occurrence)', () => {
  // "see @co then @co", completing the SECOND @co (startPos 13, len 3) to "@core/"
  const input = 'see @co then @co'
  const startPos = input.lastIndexOf('@co') // 13
  const { newInput, cursorPos } = buildFileCompletion(input, '@core/', startPos, 3)
  assert.equal(newInput, 'see @co then @core/') // first @co untouched
  assert.equal(cursorPos, startPos + '@core/'.length)

  // The old input.replace hit the FIRST occurrence -> wrong string:
  const { searchString } = oldRefresh(input, '@co', '@core/')
  assert.equal(searchString, 'see @core/ then @co')
  assert.notEqual(newInput, searchString)
})

test('cursor lands at the end of the inserted replacement, not the old offset', () => {
  // mid-line token: "a @co b", completing @co (startPos 2, len 3) -> "@core/"
  const { newInput, cursorPos } = buildFileCompletion('a @co b', '@core/', 2, 3)
  assert.equal(newInput, 'a @core/ b')
  assert.equal(cursorPos, 2 + '@core/'.length) // 8, points just after "@core/"
})

test('quoted replacement value with a space splices cleanly', () => {
  // token "@my", replacement '@"my file' (partial quoted)
  const { newInput, cursorPos } = buildFileCompletion('@my', '@"my file', 0, 3)
  assert.equal(newInput, '@"my file')
  assert.equal(cursorPos, '@"my file'.length)
})

test('replacing an empty-length token inserts at startPos', () => {
  const { newInput, cursorPos } = buildFileCompletion('a  b', 'X', 2, 0)
  assert.equal(newInput, 'a X b')
  assert.equal(cursorPos, 3)
})
