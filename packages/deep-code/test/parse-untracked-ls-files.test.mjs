import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseUntrackedLsFiles } from '../src/utils/parseUntrackedLsFiles.mjs'

test('empty / whitespace stdout yields no paths', () => {
  assert.deepEqual(parseUntrackedLsFiles(''), [])
  assert.deepEqual(parseUntrackedLsFiles('   \n  '), [])
})

test('plain ASCII paths pass through', () => {
  assert.deepEqual(parseUntrackedLsFiles('a.txt\nsrc/b.ts\n'), ['a.txt', 'src/b.ts'])
})

test('THE FIX: a C-quoted non-ASCII name is decoded to the real path', () => {
  // git C-quotes 新.txt (UTF-8 E6 96 B0 = octal \346 \226 \260) as
  // "\346\226\260.txt". Pre-fix this raw quoted string went to stat() → ENOENT →
  // the file was silently skipped.
  const decoded = parseUntrackedLsFiles('"\\346\\226\\260.txt"\n')
  assert.deepEqual(decoded, ['新.txt'])
})

test('raw non-ASCII (emitted under core.quotepath=false) passes through unchanged', () => {
  assert.deepEqual(parseUntrackedLsFiles('新.txt\n'), ['新.txt'])
})

test('a name with a tab stays quoted even under quotepath=false and is decoded', () => {
  const out = parseUntrackedLsFiles('plain.txt\n"a\\tb.txt"\n')
  assert.deepEqual(out, ['plain.txt', 'a\tb.txt'])
})

test('blank lines are filtered', () => {
  assert.deepEqual(parseUntrackedLsFiles('a\n\nb\n'), ['a', 'b'])
})
