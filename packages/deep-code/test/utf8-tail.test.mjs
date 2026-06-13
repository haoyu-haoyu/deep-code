import assert from 'node:assert/strict'
import { test } from 'node:test'

import { trimTrailingPartialUtf8 } from '../src/utils/utf8Tail.mjs'

test('a complete codepoint at the boundary is not trimmed', () => {
  const buf = Buffer.from('a€', 'utf8') // 0x61, 0xE2 0x82 0xAC
  assert.equal(buf.length, 4)
  assert.equal(trimTrailingPartialUtf8(buf, 4), 4) // whole € is present
  assert.equal(trimTrailingPartialUtf8(Buffer.from('abc'), 3), 3) // ascii
})

test('a truncated trailing multibyte codepoint is trimmed to its lead boundary', () => {
  const buf = Buffer.from('a€', 'utf8') // [0x61, 0xE2, 0x82, 0xAC]
  assert.equal(trimTrailingPartialUtf8(buf, 3), 1) // [..,0xE2,0x82] cut → drop back to 'a'
  assert.equal(trimTrailingPartialUtf8(buf, 2), 1) // lone lead 0xE2 → drop to 'a'
  // 4-byte char cut anywhere short → nothing complete precedes it → 0
  const emoji = Buffer.from('😀', 'utf8') // [0xF0,0x9F,0x98,0x80]
  assert.equal(trimTrailingPartialUtf8(emoji, 3), 0)
  assert.equal(trimTrailingPartialUtf8(emoji, 1), 0)
  assert.equal(trimTrailingPartialUtf8(emoji, 4), 4) // complete
})

test('decoding after the trim never yields a U+FFFD replacement char', () => {
  const buf = Buffer.from('abc所有', 'utf8') // CJK = 3 bytes each
  for (let cap = 1; cap < buf.length; cap++) {
    const trimmed = trimTrailingPartialUtf8(buf, cap)
    const decoded = buf.toString('utf8', 0, trimmed)
    assert.ok(!decoded.includes('�'), `cap=${cap} produced U+FFFD: ${JSON.stringify(decoded)}`)
    // the trimmed prefix is always a real prefix of the full string
    assert.ok('abc所有'.startsWith(decoded), `cap=${cap} not a prefix: ${JSON.stringify(decoded)}`)
  }
  // the buggy direct decode (no trim) DOES corrupt — proves the fix matters
  assert.ok(buf.toString('utf8', 0, 7).includes('�'))
})

test('edge cases: zero length, overflow, all-continuation slice, invalid lead', () => {
  const buf = Buffer.from('€', 'utf8')
  assert.equal(trimTrailingPartialUtf8(buf, 0), 0)
  assert.equal(trimTrailingPartialUtf8(buf, 99), 3) // clamps to buffer length, complete
  // a slice that is ALL continuation bytes (lead is before the slice) — a head
  // boundary the caller handles elsewhere; the tail trim leaves it alone.
  assert.equal(trimTrailingPartialUtf8(Buffer.from([0x82, 0x82]), 2), 2)
  // invalid lead byte (0xFF) is treated as a single byte, not trimmed away
  assert.equal(trimTrailingPartialUtf8(Buffer.from([0x61, 0xff]), 2), 2)
})

test('delta-resume: chunked reads reconstruct the full string with no corruption', () => {
  // Mirrors readFileRange + getTaskOutputDelta: read in byte-capped chunks, trim
  // each (when more follows) to a codepoint boundary, resume at the trimmed offset.
  const reassemble = (full, cap) => {
    let offset = 0
    let out = ''
    while (offset < full.length) {
      const rawEnd = Math.min(offset + cap, full.length)
      const chunk = full.subarray(offset, rawEnd)
      let end = rawEnd
      if (rawEnd < full.length) {
        const trimmed = trimTrailingPartialUtf8(chunk, chunk.length)
        if (trimmed > 0) end = offset + trimmed
      }
      out += full.toString('utf8', offset, end)
      assert.ok(end > offset, `no forward progress at offset=${offset} cap=${cap}`)
      offset = end
    }
    return out
  }

  const samples = [
    'plain ascii only',
    'mixed 所有 café €5 😀 end',
    '✓✓✓ test passed 配置.env 𝕳𝖊𝖑𝖑𝖔',
    '😀'.repeat(50),
    '€'.repeat(33) + 'x',
  ]
  for (const str of samples) {
    const buf = Buffer.from(str, 'utf8')
    for (const cap of [4, 5, 7, 8, 16, 64]) {
      const out = reassemble(buf, cap)
      assert.equal(out, str, `cap=${cap} str=${JSON.stringify(str)}`)
      assert.ok(!out.includes('�'))
    }
  }
})
