import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  WORD_DIFF_MAX_TOTAL_CHARS,
  wordDiffTooLarge,
} from '../src/native-ts/color-diff/wordDiffGuard.mjs'

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
