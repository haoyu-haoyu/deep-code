import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createUtf8ChunkDecoder,
  isRipgrepUsageError,
} from '../src/utils/ripgrepDecode.mjs'

// --- createUtf8ChunkDecoder: UTF-8 safety across chunk boundaries -------------

test('decodes a multibyte char split across two chunks without corruption', () => {
  // 中 = E4 B8 AD (3 bytes), 文 = E6 96 87. Split mid-codepoint at byte 1.
  const buf = Buffer.from('中文.ts', 'utf8')
  const a = buf.subarray(0, 1) // first byte of 中
  const b = buf.subarray(1) // rest

  const decoder = createUtf8ChunkDecoder()
  let out = decoder.write(a) + decoder.write(b) + decoder.end()
  assert.equal(out, '中文.ts')

  // Differential: the OLD per-chunk toString() corrupts the split codepoint.
  const buggy = a.toString() + b.toString()
  assert.notEqual(buggy, '中文.ts')
  assert.ok(buggy.includes('�'))
})

test('a clean stream flushes nothing at end()', () => {
  const decoder = createUtf8ChunkDecoder()
  const chunk = Buffer.from('hello 世界\n', 'utf8')
  const written = decoder.write(chunk)
  assert.equal(written, 'hello 世界\n')
  assert.equal(decoder.end(), '')
})

test('an incomplete trailing sequence flushes U+FFFD at end() (rg killed mid-char)', () => {
  const decoder = createUtf8ChunkDecoder()
  const partial = Buffer.from('中', 'utf8').subarray(0, 2) // 2 of 3 bytes
  assert.equal(decoder.write(partial), '') // held, not yet emitted
  assert.equal(decoder.end(), '�') // flushed as replacement on close
})

test('many small single-byte boundaries reassemble a multibyte run correctly', () => {
  const text = '日本語のファイル.tsx'
  const buf = Buffer.from(text, 'utf8')
  const decoder = createUtf8ChunkDecoder()
  let out = ''
  for (const byte of buf) out += decoder.write(Buffer.from([byte]))
  out += decoder.end()
  assert.equal(out, text)
})

// --- isRipgrepUsageError: code 2 only when there is NO output -----------------

test('code 2 with no output is a usage error (surface it)', () => {
  assert.equal(isRipgrepUsageError({ code: 2, hasOutput: false }), true)
})

test('code 2 WITH output is NOT a usage error (keep the partial matches)', () => {
  // rg matched files but hit e.g. an unreadable dir — exit 2 alongside results.
  assert.equal(isRipgrepUsageError({ code: 2, hasOutput: true }), false)
})

test('non-2 codes are never usage errors', () => {
  for (const code of [0, 1, 'ENOENT', 'EACCES', 'ABORT_ERR', undefined, null]) {
    assert.equal(isRipgrepUsageError({ code, hasOutput: false }), false)
    assert.equal(isRipgrepUsageError({ code, hasOutput: true }), false)
  }
})
