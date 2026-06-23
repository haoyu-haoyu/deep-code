import { test } from 'node:test'
import assert from 'node:assert/strict'

import { preservedColumnOffset } from '../src/utils/preservedColumnOffset.mjs'

// Faithful ports of MeasuredText.stringIndexToDisplayWidth /
// displayWidthToStringIndex for ASCII + CJK wide chars (no combining/ZWJ, so
// code points == graphemes). These are what Cursor.ts injects in production.
const isWide = ch => {
  const cp = ch.codePointAt(0)
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff)
  )
}
const sw = s => {
  let w = 0
  for (const ch of s) w += isWide(ch) ? 2 : 1
  return w
}
const s2d = (text, index) => {
  if (index <= 0) return 0
  if (index >= text.length) return sw(text)
  return sw(text.substring(0, index))
}
const d2s = (text, targetWidth) => {
  if (targetWidth <= 0) return 0
  if (!text) return 0
  let cur = 0
  let off = 0
  for (const ch of text) {
    const cw = isWide(ch) ? 2 : 1
    if (cur + cw > targetWidth) break
    cur += cw
    off += ch.length
  }
  return off
}

// THE FIX under test.
const preserved = (curLine, codeUnitCol, tgtLine, tgtStart) =>
  preservedColumnOffset(curLine, codeUnitCol, tgtLine, tgtStart, s2d, d2s)

// The pre-fix CODE-UNIT arithmetic (createCursorWithColumn), as a differential
// oracle: target = lineStart + min(codeUnitCol, targetLine.length).
const oldCodeUnit = (curLine, codeUnitCol, tgtLine, tgtStart) =>
  tgtStart + Math.min(codeUnitCol, tgtLine.length)

const CJK = '世界' // each display width 2

test('THE FIX: down over a wide-char current line lands at the SAME display column', () => {
  // current line "ab世界" (display col 6 at end), target "qwertyuiop" at offset 5
  const off = preserved('ab' + CJK, 4, 'qwertyuiop', 5)
  // display col 6 on an all-narrow line -> code-unit index 6 -> offset 11
  assert.equal(off, 11)
  // old code-unit col 4 -> offset 9 (display col 4) — the bug
  assert.equal(oldCodeUnit('ab' + CJK, 4, 'qwertyuiop', 5), 9)
  assert.notEqual(off, oldCodeUnit('ab' + CJK, 4, 'qwertyuiop', 5))
})

test('THE FIX: up onto a wide-char target line preserves the display column', () => {
  // current line "abcdef" cursor at code-unit/display col 4, target "世界x" at offset 0
  const off = preserved('abcdef', 4, CJK + 'x', 0)
  // display col 4 on "世界x" = right after 世界 (2+2) -> code-unit index 2 -> offset 2
  assert.equal(off, 2)
  // old: code-unit col 4 clamped to len 3 -> offset 3 (display col 5, past target)
  assert.equal(oldCodeUnit('abcdef', 4, CJK + 'x', 0), 3)
})

test('the preserved offset round-trips to the source display column (clamped to the target width)', () => {
  const cases = [
    ['ab' + CJK, 4, 'qwertyuiop', 5],
    ['abcdef', 4, CJK + 'x', 0],
    [CJK + 'z', 3, 'abcdefgh', 10], // wide current, narrow target
    ['hello', 5, CJK + CJK, 7], // narrow current at end, wide target
    ['x', 1, 'a' + CJK + 'b', 4],
  ]
  for (const [cur, col, tgt, start] of cases) {
    const off = preserved(cur, col, tgt, start)
    const srcCol = s2d(cur, col)
    const tgtWidth = sw(tgt)
    const expectedCol = Math.min(srcCol, tgtWidth)
    const resultCol = s2d(tgt, off - start)
    // the resulting display column preserves the source column, never
    // overshooting, and undershooting by at most 1 cell only when the target
    // column would fall inside a wide grapheme (can't land mid-grapheme)
    assert.ok(
      resultCol <= expectedCol && resultCol >= expectedCol - 1,
      `${JSON.stringify([cur, col, tgt, start])}: resultCol=${resultCol} expected≈${expectedCol}`,
    )
    // and the offset stays within the target line
    assert.ok(off >= start && off - start <= tgt.length)
  }
})

test('overshoot: a column past the target line clamps to the target line end', () => {
  // current "abcdefgh" col 8, target "世" (width 2) -> clamp to end of 世
  const off = preserved('abcdefgh', 8, CJK[0], 0)
  assert.equal(off, 1) // end of the single wide char
  assert.equal(s2d(CJK[0], off), 2) // display col 2 = the target's full width
})

test('all-narrow lines behave exactly like the old code-unit math (no regression)', () => {
  const cases = [
    ['hello world', 6, 'goodbye', 12],
    ['abc', 3, 'abcdef', 4],
    ['line one', 0, 'line two', 9],
    ['xxxx', 2, 'yy', 5],
  ]
  for (const [cur, col, tgt, start] of cases) {
    assert.equal(
      preserved(cur, col, tgt, start),
      oldCodeUnit(cur, col, tgt, start),
      `${JSON.stringify([cur, col, tgt, start])}`,
    )
  }
})
