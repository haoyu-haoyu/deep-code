import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseGitDiffHunks } from '../src/utils/parseGitDiffHunks.mjs'

// The `lines` a real file-diff yields: parseGitDiff splits the whole output on
// "diff --git " first, so index 0 is the residual of that split and scanning
// starts at 1. File headers (index/--- a/ /+++ b/ /mode/binary) precede the
// first @@; body lines follow it.
const MAX = 400

test('BUG FIXED: a removed "--…" line and an added "++…" line are captured, not dropped as file headers', () => {
  const lines = [
    'a/config.yml b/config.yml', // [0] residual of the "diff --git " split
    'index e69de29..0000000 100644',
    '--- a/config.yml',
    '+++ b/config.yml',
    '@@ -1,4 +1,4 @@',
    ' name: test',
    '---flag: old', // a REMOVED "--flag: old" → diff line "---flag: old"
    '+++flag: new', // an ADDED "++flag: new" → diff line "+++flag: new"
    ' version: 1',
    ' trailing: yes',
    '', // trailing '' from splitting git's final newline
  ]
  const hunks = parseGitDiffHunks(lines, MAX)
  assert.equal(hunks.length, 1)
  assert.deepEqual(hunks[0].lines, [
    ' name: test',
    '---flag: old',
    '+++flag: new',
    ' version: 1',
    ' trailing: yes',
  ])
  // The trailing '' split artifact is NOT captured.
  assert.equal(hunks[0].lines.includes(''), false)
  assert.deepEqual(
    { oldStart: hunks[0].oldStart, oldLines: hunks[0].oldLines, newStart: hunks[0].newStart, newLines: hunks[0].newLines },
    { oldStart: 1, oldLines: 4, newStart: 1, newLines: 4 },
  )
})

test('pre-hunk file headers (incl. --- a/ and +++ b/) are still skipped', () => {
  const lines = [
    'a/x b/x',
    'index 111..222 100644',
    '--- a/x',
    '+++ b/x',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '',
  ]
  const hunks = parseGitDiffHunks(lines, MAX)
  assert.equal(hunks.length, 1)
  // The file headers must NOT leak into the body; only the two change lines do.
  assert.deepEqual(hunks[0].lines, ['-old', '+new'])
})

test('multiple hunks in one file are all pushed', () => {
  const lines = [
    'a/y b/y',
    '--- a/y',
    '+++ b/y',
    '@@ -1,1 +1,1 @@',
    '-a',
    '+b',
    '@@ -10,1 +10,1 @@',
    '---c', // a REMOVED line (sigil '-') whose content is "--c"
    '+++d', // an ADDED line (sigil '+') whose content is "++d"
    '',
  ]
  const hunks = parseGitDiffHunks(lines, MAX)
  assert.equal(hunks.length, 2)
  assert.deepEqual(hunks[0].lines, ['-a', '+b'])
  // Second hunk keeps the '---'/'+++'-looking body lines instead of dropping them.
  assert.deepEqual(hunks[1].lines, ['---c', '+++d'])
})

test('the line limit caps retained body lines per file', () => {
  const body = []
  for (let n = 0; n < 10; n++) body.push('+line' + n)
  const lines = ['a/z b/z', '--- a/z', '+++ b/z', '@@ -1,0 +1,10 @@', ...body, '']
  const hunks = parseGitDiffHunks(lines, 3)
  assert.equal(hunks[0].lines.length, 3)
  assert.deepEqual(hunks[0].lines, ['+line0', '+line1', '+line2'])
})

test('a genuine blank context line (single space) is kept; empty string is not', () => {
  const lines = ['a/b b/b', '--- a/b', '+++ b/b', '@@ -1,2 +1,2 @@', ' ', '+x', '']
  const hunks = parseGitDiffHunks(lines, MAX)
  assert.deepEqual(hunks[0].lines, [' ', '+x'])
})

test('a diff with no hunks (mode-only / binary) yields no hunks and drops metadata', () => {
  const lines = ['a/m b/m', 'old mode 100644', 'new mode 100755', '']
  assert.deepEqual(parseGitDiffHunks(lines, MAX), [])
  const bin = ['a/img b/img', 'index 1..2', 'Binary files a/img and b/img differ', '']
  assert.deepEqual(parseGitDiffHunks(bin, MAX), [])
})

test('missing hunk counts default (oldLines/newLines → 1, starts → parsed)', () => {
  const lines = ['a/c b/c', '--- a/c', '+++ b/c', '@@ -5 +7 @@', '-x', '+y', '']
  const hunks = parseGitDiffHunks(lines, MAX)
  assert.deepEqual(
    { oldStart: hunks[0].oldStart, oldLines: hunks[0].oldLines, newStart: hunks[0].newStart, newLines: hunks[0].newLines },
    { oldStart: 5, oldLines: 1, newStart: 7, newLines: 1 },
  )
})
