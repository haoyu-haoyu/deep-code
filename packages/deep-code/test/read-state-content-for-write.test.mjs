import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readStateContentForWrite } from '../src/tools/FileWriteTool/readStateContentForWrite.mjs'

// The read path normalizes CRLF -> LF exactly like this (fileRead.ts:62 etc.).
// readStateContentForWrite must produce the SAME form so the staleness guard,
// which compares a fresh (normalized) read against readFileState.content, does
// not falsely flag an unmodified file.
const readNormalize = raw => raw.replaceAll('\r\n', '\n')

test('CRLF is normalized to LF', () => {
  assert.equal(readStateContentForWrite('a\r\nb\r\nc'), 'a\nb\nc')
})

test('LF-only content is unchanged', () => {
  assert.equal(readStateContentForWrite('a\nb\nc'), 'a\nb\nc')
})

test('a lone CR is preserved (matches the read normalization, which only collapses CRLF)', () => {
  // Old Mac OS 9 CR endings are intentionally not supported; the read path
  // leaves them, so this must too, or the two sides would disagree.
  assert.equal(readStateContentForWrite('a\rb\rc'), 'a\rb\rc')
})

test('mixed CRLF and lone CR: only the CRLF pairs collapse', () => {
  assert.equal(readStateContentForWrite('a\r\nb\rc\r\nd'), 'a\nb\rc\nd')
})

test('empty string is unchanged', () => {
  assert.equal(readStateContentForWrite(''), '')
})

test('idempotent: normalizing an already-normalized string is a no-op', () => {
  const once = readStateContentForWrite('x\r\ny\r\nz')
  assert.equal(readStateContentForWrite(once), once)
})

test('THE INVARIANT: the recorded form equals what a subsequent read produces', () => {
  // A write whose model content carried CRLF reaches disk as CRLF (endings=LF
  // passthrough); the next read normalizes it. The recorded readFileState must
  // match that normalized read, or the staleness guard false-positives.
  for (const content of [
    'plain ascii',
    'win\r\nlines\r\nhere',
    'no trailing\r\nnewline',
    'tab\tand\r\nunicode \u{1f600}\r\nend',
    '',
    'lone\rcr\rkept',
  ]) {
    assert.equal(
      readStateContentForWrite(content),
      readNormalize(content),
      `recorded form must equal the read-normalized form for ${JSON.stringify(content)}`,
    )
  }
})
