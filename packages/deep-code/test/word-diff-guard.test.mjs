import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  WORD_DIFF_MAX_TOTAL_CHARS,
  wordDiffTooLarge,
} from '../src/native-ts/color-diff/wordDiffGuard.mjs'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

test('the threshold is a sane positive bound', () => {
  assert.equal(typeof WORD_DIFF_MAX_TOTAL_CHARS, 'number')
  assert.ok(WORD_DIFF_MAX_TOTAL_CHARS > 0 && WORD_DIFF_MAX_TOTAL_CHARS <= 100_000)
})

test('normal lines are NOT guarded (word-diff still runs)', () => {
  assert.equal(wordDiffTooLarge('', ''), false)
  assert.equal(wordDiffTooLarge('const x = 1', 'const x = 2'), false)
  assert.equal(wordDiffTooLarge('a'.repeat(2000), 'b'.repeat(2000)), false)
})

test('a long changed line is guarded (skips the unbounded Myers diff)', () => {
  // the freeze case: replacing one long minified/lockfile/base64 line with another
  const a = 'a'.repeat(64_000)
  const b = 'b'.repeat(64_000)
  assert.equal(wordDiffTooLarge(a, b), true)
})

test('the bound is on COMBINED length, off-by-one correct', () => {
  const half = WORD_DIFF_MAX_TOTAL_CHARS / 2
  // exactly at the cap → still allowed
  assert.equal(wordDiffTooLarge('x'.repeat(half), 'y'.repeat(half)), false)
  // one char over the cap → guarded
  assert.equal(wordDiffTooLarge('x'.repeat(half), 'y'.repeat(half + 1)), true)
  // a single huge line vs an empty line is also guarded
  assert.equal(wordDiffTooLarge('z'.repeat(WORD_DIFF_MAX_TOTAL_CHARS + 1), ''), true)
})

// Source-level regression guards: BOTH word-diff render paths must consult the SSOT
// bound BEFORE invoking the unbounded Myers differ. These .tsx/.ts files are tested at
// the source level (the project's idiom — see test/sed-edit-parser.test.mjs) rather than
// executed through the Ink render runtime. If a refactor moves the guard after the diff
// call (or drops it), the synchronous-render freeze returns — these tests catch that.

test('Fallback.tsx guards the word-diff BEFORE running the unbounded differ', () => {
  const src = readFileSync(
    resolve(SRC, 'components/StructuredDiff/Fallback.tsx'),
    'utf8',
  )
  assert.ok(
    src.includes('wordDiffTooLarge'),
    'Fallback.tsx must import and use the SSOT guard',
  )
  const guardAt = src.indexOf('wordDiffTooLarge(removedLineText, addedLineText)')
  const diffAt = src.indexOf('calculateWordDiffs(removedLineText, addedLineText)')
  assert.ok(guardAt !== -1, 'Fallback.tsx must guard the paired word-diff inputs')
  assert.ok(diffAt !== -1, 'Fallback.tsx must still compute word diffs for normal lines')
  assert.ok(
    guardAt < diffAt,
    'the wordDiffTooLarge guard must run BEFORE calculateWordDiffs (else the freeze still happens)',
  )
})

test('color-diff index.ts guards wordDiffStrings BEFORE running the unbounded differ', () => {
  const src = readFileSync(resolve(SRC, 'native-ts/color-diff/index.ts'), 'utf8')
  const guardAt = src.indexOf('wordDiffTooLarge(oldStr, newStr)')
  const diffAt = src.indexOf('diffArrays(oldTokens, newTokens)')
  assert.ok(guardAt !== -1, 'color-diff must guard the word-diff inputs')
  assert.ok(diffAt !== -1, 'color-diff must still run diffArrays for normal lines')
  assert.ok(
    guardAt < diffAt,
    'the wordDiffTooLarge guard must run BEFORE diffArrays in the color-diff path',
  )
})
