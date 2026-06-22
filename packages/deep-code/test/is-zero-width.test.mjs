import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isZeroWidth } from '../src/ink/isZeroWidth.mjs'

test('THE FIX: bidirectional / explicit-formatting controls are zero-width', () => {
  // These are Default_Ignorable; the production wrap fn (string-width v7) counts
  // them as 0. Before the fix isZeroWidth returned false -> stringWidth counted
  // them as 1 -> cursor/viewport drift on pasted RTL/mixed text.
  assert.equal(isZeroWidth(0x061c), true) // ALM
  assert.equal(isZeroWidth(0x200e), true) // LRM
  assert.equal(isZeroWidth(0x200f), true) // RLM
  assert.equal(isZeroWidth(0x202a), true) // LRE
  assert.equal(isZeroWidth(0x202b), true) // RLE
  assert.equal(isZeroWidth(0x202c), true) // PDF
  assert.equal(isZeroWidth(0x202d), true) // LRO
  assert.equal(isZeroWidth(0x202e), true) // RLO
  assert.equal(isZeroWidth(0x2066), true) // LRI
  assert.equal(isZeroWidth(0x2067), true) // RLI
  assert.equal(isZeroWidth(0x2068), true) // FSI
  assert.equal(isZeroWidth(0x2069), true) // PDI
  assert.equal(isZeroWidth(0x206f), true) // deprecated format char (block end)
})

test('previously-covered zero-width characters still detected (no regression)', () => {
  assert.equal(isZeroWidth(0x200b), true) // ZWSP
  assert.equal(isZeroWidth(0x200d), true) // ZWJ
  assert.equal(isZeroWidth(0x2060), true) // word joiner
  assert.equal(isZeroWidth(0xfeff), true) // BOM
  assert.equal(isZeroWidth(0x00ad), true) // soft hyphen
  assert.equal(isZeroWidth(0xfe0f), true) // variation selector 16
  assert.equal(isZeroWidth(0x0301), true) // combining acute
  assert.equal(isZeroWidth(0x0e31), true) // Thai MAI HAN-AKAT
  assert.equal(isZeroWidth(0x094d), true) // Devanagari virama
  assert.equal(isZeroWidth(0x0000), true) // NUL (control)
})

test('ordinary printable / spacing characters remain non-zero-width', () => {
  assert.equal(isZeroWidth(0x41), false) // 'A'
  assert.equal(isZeroWidth(0x20), false) // space
  assert.equal(isZeroWidth(0x4e2d), false) // CJK 中
  assert.equal(isZeroWidth(0x0e32), false) // Thai SARA AA (spacing vowel)
  assert.equal(isZeroWidth(0x05d0), false) // Hebrew aleph (a real letter)
  assert.equal(isZeroWidth(0x0627), false) // Arabic alef (a real letter)
  // the codepoints just OUTSIDE the bidi ranges stay non-zero-width
  assert.equal(isZeroWidth(0x2010), false) // hyphen (just past 0x206f cluster)
  assert.equal(isZeroWidth(0x061b), false) // Arabic semicolon (just before ALM)
  assert.equal(isZeroWidth(0x061d), false) // just after ALM
})

test('spacing characters adjacent to the widened bidi ranges stay non-zero-width', () => {
  assert.equal(isZeroWidth(0x200a), false) // hair space, just before the 0x200b ZW block
  assert.equal(isZeroWidth(0x202f), false) // narrow no-break space (spacing), just after RLO
})
