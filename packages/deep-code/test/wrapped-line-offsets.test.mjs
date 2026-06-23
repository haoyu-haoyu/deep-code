import { test } from 'node:test'
import assert from 'node:assert/strict'
import wrapAnsiNpm from 'wrap-ansi'

import { reconstructWrappedLineOffsets } from '../src/utils/reconstructWrappedLineOffsets.mjs'

// Production at node uses the npm wrap-ansi (Bun is undefined), the same lib
// MeasuredText.measureWrappedText feeds these records. Wrap exactly as it does.
const wrap = (text, columns) =>
  wrapAnsiNpm(text, columns, { hard: true, trim: false }).split('\n')

// Verbatim port of the PREVIOUS two-cursor reconstruction (the buggy code that
// was replaced), as a differential oracle.
function oldReconstruct(lines, sourceText) {
  const records = []
  let searchOffset = 0
  let lastNewLinePos = -1
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const isPNL = startOffset =>
      i === 0 || (startOffset > 0 && sourceText[startOffset - 1] === '\n')
    if (text.length === 0) {
      lastNewLinePos = sourceText.indexOf('\n', lastNewLinePos + 1)
      if (lastNewLinePos !== -1) {
        records.push({
          text,
          startOffset: lastNewLinePos,
          isPrecededByNewline: isPNL(lastNewLinePos),
          endsWithNewline: true,
        })
      } else {
        const startOffset = sourceText.length
        records.push({
          text,
          startOffset,
          isPrecededByNewline: isPNL(startOffset),
          endsWithNewline: false,
        })
      }
    } else {
      const startOffset = sourceText.indexOf(text, searchOffset)
      if (startOffset === -1) throw new Error('Failed to find wrapped line in text')
      searchOffset = startOffset + text.length
      const potentialNewlinePos = startOffset + text.length
      const endsWithNewline =
        potentialNewlinePos < sourceText.length &&
        sourceText[potentialNewlinePos] === '\n'
      if (endsWithNewline) lastNewLinePos = potentialNewlinePos
      records.push({
        text,
        startOffset,
        isPrecededByNewline: isPNL(startOffset),
        endsWithNewline,
      })
    }
  }
  return records
}

const offsets = recs => recs.map(r => r.startOffset)
const isMonotonic = arr => arr.every((v, i) => i === 0 || v >= arr[i - 1])

// getPositionFromOffset's line-selection loop (verbatim), the consumer that
// breaks when startOffsets are non-monotonic.
function selectLine(records, offset) {
  for (let line = 0; line < records.length; line++) {
    const cur = records[line]
    const next = records[line + 1]
    if (offset >= cur.startOffset && (!next || offset < next.startOffset)) {
      return line
    }
  }
  return records.length - 1
}

const CJK1 = String.fromCharCode(0x4e00) // 一  (display width 2)
const CJK2 = String.fromCharCode(0x4e8c) // 二
const ZWJ = String.fromCharCode(0x200d)
const FAMILY =
  String.fromCodePoint(0x1f468) +
  ZWJ +
  String.fromCodePoint(0x1f469) +
  ZWJ +
  String.fromCodePoint(0x1f467) +
  ZWJ +
  String.fromCodePoint(0x1f466) // 👨‍👩‍👧‍👦

test('THE BUG: a single wide grapheme at columns=1 — old offsets non-monotonic, new monotonic', () => {
  const text = CJK1
  const lines = wrap(text, 1) // ['', '一']
  assert.deepEqual(lines, ['', CJK1])
  const oldR = oldReconstruct(lines, text)
  const newR = reconstructWrappedLineOffsets(lines, text)
  assert.deepEqual(offsets(oldR), [1, 0]) // text.length then content — broken
  assert.deepEqual(offsets(newR), [0, 0]) // monotonic
  assert.ok(isMonotonic(offsets(newR)))
})

test('THE BUG (embedded newline): old maps the offset of the second char to the wrong row', () => {
  const text = CJK1 + '\n' + CJK2 // 一\n二
  const lines = wrap(text, 1)
  assert.deepEqual(lines, ['', CJK1, '', CJK2])
  const oldR = oldReconstruct(lines, text)
  const newR = reconstructWrappedLineOffsets(lines, text)
  assert.deepEqual(offsets(oldR), [1, 0, 3, 2]) // non-monotonic
  assert.deepEqual(offsets(newR), [0, 0, 2, 2]) // monotonic
  // offset 2 is '二' (after the '\n'). It belongs to the row whose text === 二.
  const offsetOfSecond = 2
  assert.equal(lines[selectLine(oldR, offsetOfSecond)], CJK1) // BUG: the 一 row
  assert.equal(lines[selectLine(newR, offsetOfSecond)], CJK2) // FIXED: the 二 row
})

test('a ZWJ family emoji at columns=1 — old offsets non-monotonic, new monotonic + verbatim slices', () => {
  const text = FAMILY
  const lines = wrap(text, 1)
  const newR = reconstructWrappedLineOffsets(lines, text)
  assert.ok(isMonotonic(offsets(newR)), `offsets ${offsets(newR)}`)
  assert.ok(
    !isMonotonic(offsets(oldReconstruct(lines, text))),
    'old is non-monotonic for this input',
  )
  for (const r of newR) {
    if (r.text.length > 0) {
      assert.equal(text.slice(r.startOffset, r.startOffset + r.text.length), r.text)
    }
  }
})

test('well-formed text (no wrap-induced blank) is byte-identical to the old reconstruction', () => {
  const cases = [
    ['hello world', 20],
    ['hello world', 5],
    ['ab\n\ncd', 10],
    ['ab\ncd\n', 10],
    ['a\n\n\nb', 4],
    ['line one is quite long\nshort\n\nlast', 8],
    ['trailing newline\n', 40],
    ['', 10],
    ['\n', 10],
    ['\n\n\n', 10],
    ['word ' + 'x'.repeat(30), 7],
  ]
  for (const [text, cols] of cases) {
    const lines = wrap(text, cols)
    const oldR = oldReconstruct(lines, text)
    const newR = reconstructWrappedLineOffsets(lines, text)
    // these inputs produce monotonic old offsets (no wide-char overflow)
    assert.ok(isMonotonic(offsets(oldR)), `precondition: old monotonic for ${JSON.stringify(text)}`)
    assert.deepEqual(newR, oldR, `byte-identical for ${JSON.stringify(text)} @ ${cols}`)
  }
})

test('FUZZ: new offsets are always monotonic + verbatim slices; identical to old whenever old is monotonic', () => {
  // deterministic LCG so failures reproduce
  let seed = 0x1234abcd
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const alphabet = ['a', 'b', ' ', '\n', CJK1, CJK2, 'z', '.', FAMILY]
  for (let iter = 0; iter < 4000; iter++) {
    const len = Math.floor(rnd() * 12)
    let text = ''
    for (let k = 0; k < len; k++) {
      text += alphabet[Math.floor(rnd() * alphabet.length)]
    }
    text = text.normalize('NFC') // MeasuredText normalizes its text
    const cols = 1 + Math.floor(rnd() * 8)
    const lines = wrap(text, cols)
    const newR = reconstructWrappedLineOffsets(lines, text)
    const newOff = offsets(newR)
    // INVARIANT 1: monotonic non-decreasing
    assert.ok(
      isMonotonic(newOff),
      `non-monotonic ${JSON.stringify(text)} @ ${cols}: ${newOff}`,
    )
    // INVARIANT 2: each non-empty line is the verbatim source slice at its offset
    for (const r of newR) {
      if (r.text.length > 0) {
        assert.equal(
          text.slice(r.startOffset, r.startOffset + r.text.length),
          r.text,
          `slice mismatch ${JSON.stringify(text)} @ ${cols}`,
        )
      }
    }
    // INVARIANT 3: where the old reconstruction was already correct (monotonic),
    // the new one reproduces it exactly (records and all four fields).
    const oldR = oldReconstruct(lines, text)
    if (isMonotonic(offsets(oldR))) {
      assert.deepEqual(
        newR,
        oldR,
        `divergence on a well-formed input ${JSON.stringify(text)} @ ${cols}`,
      )
    }
  }
})
