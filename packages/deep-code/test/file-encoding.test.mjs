import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectEncodingFromHeadBytes } from '../src/utils/fileEncoding.mjs'
import { stripLeadingBom } from '../src/utils/bom.mjs'

test('empty buffer (0 bytes) → utf8', () => {
  assert.equal(detectEncodingFromHeadBytes(Buffer.alloc(0), 0), 'utf8')
})

test('UTF-16LE BOM (FF FE) → utf16le', () => {
  assert.equal(
    detectEncodingFromHeadBytes(Buffer.from([0xff, 0xfe, 0x41, 0x00]), 4),
    'utf16le',
  )
  // exactly 2 bytes of BOM
  assert.equal(detectEncodingFromHeadBytes(Buffer.from([0xff, 0xfe]), 2), 'utf16le')
})

test('UTF-8 BOM (EF BB BF) → utf8', () => {
  assert.equal(
    detectEncodingFromHeadBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x41]), 4),
    'utf8',
  )
})

test('plain ASCII / unmarked content → utf8', () => {
  assert.equal(
    detectEncodingFromHeadBytes(Buffer.from('hello world', 'utf8'), 11),
    'utf8',
  )
})

test('a single byte (cannot hold the 2-byte BOM) → utf8', () => {
  assert.equal(detectEncodingFromHeadBytes(Buffer.from([0xff]), 1), 'utf8')
})

test('FF without a following FE → utf8 (not a UTF-16LE BOM)', () => {
  assert.equal(detectEncodingFromHeadBytes(Buffer.from([0xff, 0x41]), 2), 'utf8')
})

test('bytesRead bounds the decision, not buffer.length', () => {
  // A 4 KB buffer with only 1 valid byte read must not peek past bytesRead.
  const buf = Buffer.alloc(4096)
  buf[0] = 0xff
  buf[1] = 0xfe // stale zero-fill would look like a BOM if we ignored bytesRead
  assert.equal(detectEncodingFromHeadBytes(buf, 1), 'utf8')
})

// End-to-end decode contract: this is exactly the pipeline the readFileInRange
// fast path now uses (read bytes → detect from buffer → toString(encoding) →
// stripLeadingBom). It proves a real UTF-16LE-with-BOM file decodes to readable
// text and that the old unconditional 'utf8' decode produced garbage.
test('real UTF-16LE file decodes to readable text via the shared pipeline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-enc-'))
  try {
    const text = 'const x = 42\nconst π = "café"\nline three\n'

    // UTF-16LE on disk WITH a BOM (FF FE), as Windows tools emit. Node's utf16le
    // encoder does NOT add a BOM, so prepend U+FEFF explicitly (escape, not a
    // literal zero-width char in source).
    const u16 = join(dir, 'u16.txt')
    const BOM = String.fromCharCode(0xfeff)
    writeFileSync(u16, BOM + text, 'utf16le')

    // UTF-8 baseline.
    const u8 = join(dir, 'u8.txt')
    writeFileSync(u8, text, 'utf8')

    const decode = path => {
      const buf = readFileSync(path)
      const enc = detectEncodingFromHeadBytes(buf, buf.length)
      return stripLeadingBom(buf.toString(enc))
    }

    assert.equal(decode(u16), text, 'utf16le file round-trips to the original text')
    assert.equal(decode(u8), text, 'utf8 file round-trips unchanged')

    // The bug: decoding the utf16le bytes as utf8 interleaves NUL bytes.
    const u16buf = readFileSync(u16)
    const asUtf8 = u16buf.toString('utf8')
    assert.notEqual(
      stripLeadingBom(asUtf8),
      text,
      'old unconditional utf8 decode must NOT reproduce the text',
    )
    assert.ok(
      asUtf8.includes(String.fromCharCode(0)),
      'old utf8 decode contains NUL garbage',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
