import { test } from 'node:test'
import assert from 'node:assert/strict'

import { displayWidth, truncateToWidth } from '../src/deepcode/displayWidth.mjs'

// Build all non-ASCII inputs from code points (never \u literals).
const ZWJ = String.fromCodePoint(0x200d)
const MAN = String.fromCodePoint(0x1f468)
const WOMAN = String.fromCodePoint(0x1f469)
const GIRL = String.fromCodePoint(0x1f467)
// 👨‍👩‍👧 — a single ZWJ "family" grapheme cluster.
const FAMILY = MAN + ZWJ + WOMAN + ZWJ + GIRL
const THUMBSUP = String.fromCodePoint(0x1f44d)
const SKIN = String.fromCodePoint(0x1f3fb) // emoji skin-tone modifier
const THUMBSUP_TONED = THUMBSUP + SKIN // single skin-toned grapheme cluster
const ACUTE = String.fromCodePoint(0x301) // combining acute accent
const E_ACUTE = 'e' + ACUTE // é as base + combining mark (one grapheme)
const CJK = String.fromCodePoint(0x4e2d) // 中, width 2

// The exact pre-fix implementation: iterate by CODE POINT. Kept here as a
// differential oracle so the test proves the bug it fixes.
function truncateByCodePoint(value, maxWidth) {
  let width = 0
  let result = ''
  for (const char of String(value ?? '')) {
    const charWidth = displayWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    result += char
  }
  return result
}

const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })

// True iff `result` is exactly a whole-grapheme prefix of `original`
// (i.e. the cut fell on a cluster boundary, not in the middle of one).
function isGraphemePrefix(original, result) {
  let acc = ''
  for (const { segment } of seg.segment(original)) {
    if (acc === result) return true
    acc += segment
  }
  return acc === result
}

test('THE FIX: truncating a ZWJ family emoji never splits the cluster', () => {
  // The family is one width-2 grapheme; at width 3 it fits whole.
  assert.equal(displayWidth(FAMILY), 2)
  const out = truncateToWidth(FAMILY, 3)
  assert.equal(out, FAMILY)
  // No dangling joiner, and the cut is on a cluster boundary.
  assert.ok(!out.endsWith(ZWJ), 'must not end with a dangling ZWJ')
  assert.ok(isGraphemePrefix(FAMILY, out))
})

test('differential: the old code-point loop left a dangling ZWJ, the new one does not', () => {
  // Budget 3 on the family alone is the exact bug window: the old loop adds MAN (2)
  // then the width-0 ZWJ (still 2 <= 3), then WOMAN overflows -> it stops on
  // "MAN + ZWJ" with a dangling joiner. The new loop treats the whole family as one
  // width-2 cluster, so it keeps it whole.
  const oldOut = truncateByCodePoint(FAMILY, 3)
  const newOut = truncateToWidth(FAMILY, 3)
  assert.equal(oldOut, MAN + ZWJ)
  assert.ok(oldOut.endsWith(ZWJ), 'the old impl ended on a dangling ZWJ')
  assert.equal(isGraphemePrefix(FAMILY, oldOut), false) // cut inside the cluster
  // The new impl cut on a cluster boundary (here: kept the whole family).
  assert.equal(newOut, FAMILY)
  assert.equal(isGraphemePrefix(FAMILY, newOut), true)
  assert.ok(!newOut.includes(ZWJ) || newOut.endsWith(GIRL), 'no stray trailing joiner')
})

test('a width-2 emoji cluster that does not fit is dropped whole (no lone base/modifier)', () => {
  assert.equal(displayWidth(THUMBSUP_TONED), 2)
  assert.equal(truncateToWidth(THUMBSUP_TONED, 1), '') // cannot fit 2 cells in 1
  assert.equal(truncateToWidth(THUMBSUP_TONED, 2), THUMBSUP_TONED) // fits whole
})

test('base + combining mark stays attached to its base', () => {
  assert.equal(displayWidth(E_ACUTE), 1)
  // At width 1 the é fits; the trailing x overflows. Base and mark stay together.
  const out = truncateToWidth(E_ACUTE + 'x', 1)
  assert.equal(out, E_ACUTE)
  assert.ok(isGraphemePrefix(E_ACUTE + 'x', out))
})

test('ASCII truncation is unchanged', () => {
  assert.equal(truncateToWidth('hello world', 5), 'hello')
  assert.equal(truncateToWidth('hello', 100), 'hello')
  assert.equal(truncateToWidth('abc', 0), '')
  assert.equal(truncateToWidth('', 5), '')
})

test('CJK truncation never splits a wide char and respects odd budgets', () => {
  // 中文字 — each is width 2. Budget 3 fits only the first (2); the second would hit 4.
  assert.equal(truncateToWidth(CJK + String.fromCodePoint(0x6587, 0x5b57), 3), CJK)
  assert.equal(truncateToWidth(CJK + CJK, 4), CJK + CJK)
})

test('ANSI is stripped before measuring (width budget is visible cells)', () => {
  const ESC = String.fromCodePoint(0x1b)
  const red = ESC + '[31m' + 'abcdef' + ESC + '[0m'
  assert.equal(truncateToWidth(red, 3), 'abc')
})
