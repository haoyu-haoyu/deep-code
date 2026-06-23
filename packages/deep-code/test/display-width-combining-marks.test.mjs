import { test } from 'node:test'
import assert from 'node:assert/strict'

import { displayWidth } from '../src/deepcode/displayWidth.mjs'
import { isZeroWidth } from '../src/ink/isZeroWidth.mjs'

const cp = String.fromCodePoint

test('THE FIX: non-Latin combining marks count as zero cells (fast path)', () => {
  // base consonant (width 1) + combining mark (width 0) renders as one cell.
  assert.equal(displayWidth(cp(0x0915) + cp(0x094d)), 1) // Devanagari KA + virama
  assert.equal(displayWidth(cp(0x0e01) + cp(0x0e31)), 1) // Thai KO KAI + MAI HAN-AKAT
  assert.equal(displayWidth(cp(0x0e01) + cp(0x0e34)), 1) // Thai KO KAI + SARA I
  assert.equal(displayWidth('x' + cp(0x20d0)), 1) // combining mark for symbols (was missed by the fast path)
})

test('THE FIX: bidi controls and astral zero-width code points count as zero', () => {
  assert.equal(displayWidth('a' + cp(0x200e) + 'b'), 2) // LRM between two letters
  assert.equal(displayWidth('a' + cp(0x202a) + 'b'), 2) // LRE
  assert.equal(displayWidth(cp(0xe0000)), 0) // language tag (astral)
  assert.equal(displayWidth('a' + cp(0xe0101)), 1) // astral variation selector — surrogate advance + skip
})

test('the native predicate now AGREES with the shared isZeroWidth leaf', () => {
  for (const code of [0x094d, 0x0e31, 0x0e34, 0x20d0, 0x200e, 0x202a, 0xe0000, 0xe0101]) {
    assert.equal(isZeroWidth(code), true, `0x${code.toString(16)}`)
  }
})

test('fast path and segmentation path agree on the same combining mark', () => {
  const thai = cp(0x0e01) + cp(0x0e31) // no emoji -> fast path
  const withEmoji = thai + cp(0x1f600) // emoji -> segmentation path
  assert.equal(displayWidth(thai), 1)
  // the emoji adds 2; the Thai cluster still contributes 1 on the segmentation path
  assert.equal(displayWidth(withEmoji), 3)
})

test('no regression: ASCII, CJK, spacing vowels, and Latin combining marks unchanged', () => {
  assert.equal(displayWidth('hello world'), 11)
  assert.equal(displayWidth(cp(0x4e2d) + cp(0x6587)), 4) // 中文 -> 2+2
  assert.equal(displayWidth(cp(0x0e32)), 1) // Thai SARA AA is a SPACING vowel (width 1, not zero)
  assert.equal(displayWidth(cp(0x0e33)), 1) // Thai SARA AM (spacing)
  assert.equal(displayWidth('e' + cp(0x0301)), 1) // e + combining acute (already zero)
  assert.equal(displayWidth(''), 0)
  assert.equal(displayWidth('A'), 1)
})

test('no regression: emoji clusters still measure 2 (skin-tone path unaffected)', () => {
  assert.equal(displayWidth(cp(0x1f600)), 2) // 😀
  assert.equal(displayWidth(cp(0x1f44d) + cp(0x1f3fb)), 2) // 👍 + skin tone
})
