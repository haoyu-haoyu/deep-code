import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hunkToSnippetSection } from '../src/tools/FileEditTool/twoFileDiffSnippet.mjs'

// A structuredPatch hunk: oldStart/newStart are 1-indexed; `lines` carry a
// one-char diff marker (' ' context, '+' added, '-' deleted, '\' metadata).

test('THE FIX: the section is numbered from newStart, not oldStart', () => {
  // A later hunk after earlier insertions shifted the file: oldStart 5, newStart 7.
  const hunk = {
    oldStart: 5,
    newStart: 7,
    lines: [' ctx', '+added', ' ctx2'],
  }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.startLine, 7) // newStart — the new-file line of the first kept line
  assert.notEqual(section.startLine, 5) // NOT oldStart
})

test('deleted lines are dropped; context and added lines are kept, markers stripped', () => {
  const hunk = {
    oldStart: 1,
    newStart: 1,
    lines: [' keep', '-gone', '+new', ' keep2'],
  }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.content, 'keep\nnew\nkeep2')
})

test('the "\\ No newline at end of file" metadata line is dropped', () => {
  const hunk = {
    oldStart: 1,
    newStart: 1,
    lines: [' a', '+b', '\\ No newline at end of file'],
  }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.content, 'a\nb')
})

test('the kept lines are exactly the new-file view (deletions take no new-file line)', () => {
  // new file lines, starting at newStart, are: ctx(7) added(8) ctx2(9).
  // The deleted line at old position does NOT occupy a new-file line, so the
  // kept lines stay consecutive from newStart — newStart numbering is correct.
  const hunk = {
    oldStart: 5,
    newStart: 7,
    lines: [' ctx', '-removed', '+added', ' ctx2'],
  }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.startLine, 7)
  assert.equal(section.content, 'ctx\nadded\nctx2')
  // The three kept lines map to new-file lines 7, 8, 9 when numbered from startLine.
  const numbered = section.content
    .split('\n')
    .map((line, i) => `${i + section.startLine}:${line}`)
  assert.deepEqual(numbered, ['7:ctx', '8:added', '9:ctx2'])
})

test('a pure-deletion hunk yields empty content', () => {
  const hunk = { oldStart: 3, newStart: 3, lines: ['-x', '-y'] }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.content, '')
})

test('first hunk (oldStart === newStart) is unchanged by the fix', () => {
  const hunk = { oldStart: 1, newStart: 1, lines: [' a', '+b'] }
  const section = hunkToSnippetSection(hunk)
  assert.equal(section.startLine, 1)
})
