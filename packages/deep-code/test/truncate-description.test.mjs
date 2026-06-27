import { test } from 'node:test'
import assert from 'node:assert/strict'

import { truncateDescription } from '../src/utils/truncateDescription.mjs'

// A lone surrogate is a UTF-16 code unit in [0xD800, 0xDFFF] that is not paired.
const hasLoneSurrogate = s => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true
    }
  }
  return false
}

test('short text passes through unchanged', () => {
  assert.equal(truncateDescription('a short description'), 'a short description')
  const exactly100 = 'x'.repeat(100)
  assert.equal(truncateDescription(exactly100), exactly100)
})

test('long ASCII is truncated to 97 + ellipsis (byte-identical to the old behavior)', () => {
  const long = 'a'.repeat(150)
  const out = truncateDescription(long)
  assert.equal(out, 'a'.repeat(97) + '...')
  assert.equal(out.length, 100)
})

test('THE FIX: an emoji straddling the 97-unit boundary is not split into a lone surrogate', () => {
  // 96 ASCII chars, then an emoji (2 code units at index 96 and 97). The old
  // substring(0, 97) would keep index 96 (the lone high surrogate) and cut the
  // low half -> invalid UTF-16.
  const text = 'a'.repeat(96) + '\u{1F3A8}' + 'b'.repeat(20) // 🎨
  const out = truncateDescription(text)
  assert.ok(!hasLoneSurrogate(out), 'output must not contain a lone surrogate')
  // Backed off by one code unit: 96 kept + ellipsis.
  assert.equal(out, 'a'.repeat(96) + '...')
})

test('an emoji that fits wholly within the boundary is preserved', () => {
  // Emoji ends at index 96/97-ish but fully inside the kept prefix.
  const text = 'a'.repeat(95) + '\u{1F3A8}' + 'b'.repeat(30)
  const out = truncateDescription(text)
  assert.ok(!hasLoneSurrogate(out))
  assert.ok(out.includes('\u{1F3A8}'), 'a wholly-contained emoji is kept intact')
  assert.ok(out.length <= 100)
})

test('always <= 100 code units and never a lone surrogate, across boundary offsets', () => {
  for (let pad = 90; pad <= 105; pad++) {
    const text = 'a'.repeat(pad) + '\u{1F600}'.repeat(10) // 😀
    const out = truncateDescription(text)
    assert.ok(out.length <= 100, `len ${out.length} at pad ${pad}`)
    assert.ok(!hasLoneSurrogate(out), `lone surrogate at pad ${pad}`)
  }
})
