import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyEditToFile } from '../src/tools/FileEditTool/applyEditToFile.mjs'

// applyEditToFile is the SOLE producer of post-edit text — the write path
// (getPatchForEdits), the IDE accept path, and FileEditTool's settings-file
// validation simulation all route through it. These tests pin the two ways the
// previous settings simulation (a bare `content.replace(old, new)`) diverged
// from it, so a future revert to string-replace is caught.

// The exact pre-fix settings simulation, as a differential oracle.
const oldSimulate = (file, oldS, newS, replaceAll) =>
  replaceAll ? file.replaceAll(oldS, newS) : file.replace(oldS, newS)

test('non-empty replacement returns the new content (parity with string replace)', () => {
  assert.equal(applyEditToFile('a foo b', 'foo', 'bar', false), 'a bar b')
  assert.equal(applyEditToFile('x x x', 'x', 'y', true), 'y y y')
})

test('DIVERGENCE 1: empty new_string consumes the occurrence trailing newline', () => {
  const file = 'keep\nDROP\nkeep2\n'
  // applyEditToFile delegates to deleteOccurrences: removes DROP AND its newline
  assert.equal(applyEditToFile(file, 'DROP', '', false), 'keep\nkeep2\n')
  // the old string-replace left the now-blank line behind
  assert.equal(oldSimulate(file, 'DROP', '', false), 'keep\n\nkeep2\n')
  assert.notEqual(
    applyEditToFile(file, 'DROP', '', false),
    oldSimulate(file, 'DROP', '', false),
  )
})

test('DIVERGENCE 1 (replace_all): every deleted occurrence drops its newline', () => {
  const file = 'a\nDROP\nb\nDROP\nc\n'
  assert.equal(applyEditToFile(file, 'DROP', '', true), 'a\nb\nc\n')
  assert.equal(oldSimulate(file, 'DROP', '', true), 'a\n\nb\n\nc\n')
})

test('DIVERGENCE 2: a $-sequence in new_string is inserted literally', () => {
  const file = 'price = OLD'
  // $$ / $& / $` / $1 must NOT be interpreted as replacement patterns
  for (const repl of ['$$5', '$& matched', 'cost $`', '$1 group', '$$$$']) {
    assert.equal(
      applyEditToFile(file, 'OLD', repl, false),
      'price = ' + repl,
      `literal: ${repl}`,
    )
  }
  // the old string-replace corrupted $$ -> $ and $& -> the matched text
  assert.equal(oldSimulate(file, 'OLD', '$$5', false), 'price = $5')
  assert.equal(oldSimulate(file, 'OLD', '$& x', false), 'price = OLD x')
  assert.notEqual(
    applyEditToFile(file, 'OLD', '$$5', false),
    oldSimulate(file, 'OLD', '$$5', false),
  )
})

test('DIVERGENCE 2 (replace_all): $-sequences stay literal for every occurrence', () => {
  assert.equal(applyEditToFile('OLD OLD', 'OLD', '$$', true), '$$ $$')
  assert.equal(oldSimulate('OLD OLD', 'OLD', '$$', true), '$ $')
})

test('ordinary replacements with no $ and no deletion agree with string replace', () => {
  const file = 'alpha beta alpha'
  assert.equal(
    applyEditToFile(file, 'alpha', 'ALPHA', true),
    oldSimulate(file, 'alpha', 'ALPHA', true),
  )
})
