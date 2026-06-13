import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyTextReadResult } from '../src/tools/FileReadTool/textReadResult.mjs'

test('non-empty content → content', () => {
  assert.equal(classifyTextReadResult({ content: 'hello\n', numLines: 1 }), 'content')
  // truthiness of content wins even if numLines is 0 (defensive)
  assert.equal(classifyTextReadResult({ content: 'x', numLines: 0 }), 'content')
})

test('empty (0-byte) file → empty, NOT beyond_eof', () => {
  // The fast read path returns {content:'', numLines:1, totalLines:1} for a 0-byte
  // file, so it must classify as "empty" — the bug was reporting "shorter than the
  // provided offset" because the mapper keyed off totalLines (never 0) instead.
  assert.equal(classifyTextReadResult({ content: '', numLines: 1 }), 'empty')
})

test('a selected blank line in a larger file → empty, NOT beyond_eof', () => {
  // offset=50 limit=1 where line 50 is blank → {content:'', numLines:1, totalLines:100}
  assert.equal(
    classifyTextReadResult({ content: '', numLines: 1, totalLines: 100 }),
    'empty',
  )
})

test('offset past EOF (no lines selected) → beyond_eof', () => {
  // numLines === 0 is the only honest "offset is past the end" signal.
  assert.equal(classifyTextReadResult({ content: '', numLines: 0 }), 'beyond_eof')
  assert.equal(
    classifyTextReadResult({ content: '', numLines: 0, totalLines: 100 }),
    'beyond_eof',
  )
})
