import { test } from 'node:test'
import assert from 'node:assert/strict'

import { unquoteGitPath } from '../src/utils/unquoteGitPath.mjs'
import { extractDiffFilePath } from '../src/utils/gitDiffHeader.mjs'

test('unquoteGitPath: a non-quoted path is returned unchanged', () => {
  assert.equal(unquoteGitPath('plain.txt'), 'plain.txt')
  assert.equal(unquoteGitPath('dir/sub/file.txt'), 'dir/sub/file.txt')
  // raw non-ASCII (core.quotepath=false leaves it unquoted) passes through
  assert.equal(unquoteGitPath(String.fromCodePoint(0x65b0) + '.txt'), String.fromCodePoint(0x65b0) + '.txt')
})

test('unquoteGitPath: decodes the standard C-escapes', () => {
  assert.equal(unquoteGitPath('"has\\"quote.txt"'), 'has"quote.txt') // \" -> "
  assert.equal(unquoteGitPath('"back\\\\slash.txt"'), 'back\\slash.txt') // \\ -> \
  assert.equal(unquoteGitPath('"tab\\there.txt"'), 'tab\there.txt') // \t -> TAB
  assert.equal(unquoteGitPath('"line\\nbreak.txt"'), 'line\nbreak.txt') // \n -> LF
})

test('unquoteGitPath: reassembles octal escapes as UTF-8 (core.quotepath=true)', () => {
  // 新 = U+65B0 = UTF-8 E6 96 B0 = octal \346\226\260
  assert.equal(
    unquoteGitPath('"\\346\\226\\260.txt"'),
    String.fromCodePoint(0x65b0) + '.txt',
  )
})

test('THE FIX: extractDiffFilePath decodes a C-quoted header instead of returning null', () => {
  const lines = [
    '"a/has\\"quote.txt" "b/has\\"quote.txt"', // lines[0] = the a/X b/Y header
    'index 0000001..0ddf2ba 100644',
    '--- "a/has\\"quote.txt"',
    '+++ "b/has\\"quote.txt"',
    '@@ -1 +1 @@',
    '-x',
    '+y',
  ]
  assert.equal(extractDiffFilePath(lines), 'has"quote.txt')
})

test('join: the quoted diff header and the quoted numstat key decode to the SAME path', () => {
  const headerLines = [
    '"a/tab\\there.txt" "b/tab\\there.txt"',
    '--- "a/tab\\there.txt"',
    '+++ "b/tab\\there.txt"',
    '@@ -1 +1 @@',
  ]
  const numstatKey = '"tab\\there.txt"' // numstat: <added>\t<removed>\t"tab\there.txt"
  assert.equal(extractDiffFilePath(headerLines), unquoteGitPath(numstatKey))
  assert.equal(extractDiffFilePath(headerLines), 'tab\there.txt')
})

test('regression: unquoted headers (incl. the `a b/` dir case) are unchanged', () => {
  assert.equal(
    extractDiffFilePath(['a/normal.txt b/normal.txt', '--- a/normal.txt', '+++ b/normal.txt', '@@ -1 +1 @@']),
    'normal.txt',
  )
  // dir named "a b" — the +++ single-path form is immune to the ` b/` substring
  assert.equal(
    extractDiffFilePath(['a/a b/c.txt b/a b/c.txt', '--- a/a b/c.txt', '+++ b/a b/c.txt', '@@ -1 +1 @@']),
    'a b/c.txt',
  )
  // new file: --- is /dev/null, +++ carries the path
  assert.equal(
    extractDiffFilePath(['a/new.txt b/new.txt', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1 @@']),
    'new.txt',
  )
})
