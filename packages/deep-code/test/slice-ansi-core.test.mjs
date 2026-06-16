import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ansiCodesToString as TOSTR,
  reduceAnsiCodes as REDUCE,
  tokenize as TOKENIZE,
  undoAnsiCodes as UNDO,
} from '@alcalzone/ansi-tokenize'
import emojiRegex from 'emoji-regex'
import { eastAsianWidth } from 'get-east-asian-width'
import stripAnsi from 'strip-ansi'

import sliceAnsiCore from '../src/utils/sliceAnsi.core.mjs'

// --- faithful deps (same npm packages + segmenter the production stringWidth uses) ---
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const EMOJI = emojiRegex()

function isZeroWidth(cp) {
  return (
    cp === 0x200d || // ZWJ
    cp === 0x200b ||
    cp === 0xfeff || // ZWSP / BOM
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff)
  )
}

// Mirrors stringWidth.ts: strip ANSI first, then grapheme-cluster aware,
// emoji=2, count the first non-zero-width codepoint per cluster, ambiguous-as-narrow.
function stringWidth(str) {
  if (str.includes('\x1b')) str = stripAnsi(str)
  let width = 0
  for (const { segment: g } of SEG.segment(str)) {
    EMOJI.lastIndex = 0
    if (EMOJI.test(g)) {
      width += 2
      continue
    }
    for (const ch of g) {
      const cp = ch.codePointAt(0)
      if (!isZeroWidth(cp)) {
        width += eastAsianWidth(cp, { ambiguousAsWide: false })
        break
      }
    }
  }
  return width
}

function splitGraphemes(value) {
  const out = []
  for (const { segment } of SEG.segment(value)) out.push(segment)
  return out
}

const DEPS = { stringWidth, splitGraphemes }
const slice = (s, a, b) => sliceAnsiCore(s, a, b, DEPS)

// --- F1: cut INSIDE a wide text run (the core defect) ---

test('plain ASCII: sliceAnsi is an exact substring by display cell', () => {
  assert.equal(slice('hello world', 0, 5), 'hello')
  assert.equal(slice('hello world', 6, 11), 'world')
  assert.equal(slice('hello world', 2, 5), 'llo')
  assert.equal(slice('hello world', 0, 11), 'hello world')
  assert.equal(slice('hello world', 3), 'lo world') // end undefined → to end
})

test('truncate-start no longer collapses: the tail slice is the real tail, not ""', () => {
  const s = 'a'.repeat(49)
  // wrap-text truncate('start') does ELLIPSIS + sliceFit(text, len-cols+1, len).
  // The old whole-run handling returned '' here → just "…".
  const tail = slice(s, 30, 49)
  assert.equal(tail, 'a'.repeat(19))
  assert.equal(stringWidth(tail), 19)
})

test('overflow=hidden / truncate-end: width never exceeds the requested window', () => {
  const s = 'the quick brown fox jumps'
  assert.equal(stringWidth(slice(s, 0, 9)), 9)
  assert.equal(slice(s, 0, 9), 'the quick')
})

test('CJK runs cut on aligned cell boundaries (each char = 2 cells)', () => {
  const s = '中文报告' // 8 cells
  assert.equal(slice(s, 0, 4), '中文')
  assert.equal(slice(s, 4, 8), '报告')
  assert.equal(slice(s, 2, 6), '文报')
  assert.equal(stringWidth(slice(s, 0, 4)), 4)
})

test('a wide char straddling `end` overshoots by at most one cell (sliceFit retries)', () => {
  const s = 'a中b' // widths 1,2,1
  // cell window [0,2) wants 'a' + left half of 中 — can only keep whole 中.
  const out = slice(s, 0, 2)
  assert.ok(stringWidth(out) <= 3, `overshoot bounded, got width ${stringWidth(out)}`)
  assert.ok(stringWidth(out) >= 2)
  // clean boundaries are exact:
  assert.equal(slice(s, 0, 1), 'a')
  assert.equal(slice(s, 0, 3), 'a中')
  assert.equal(slice(s, 1, 3), '中')
})

test('emoji (incl. ZWJ family) is never split mid-cluster', () => {
  const s = 'a😀b'
  assert.equal(slice(s, 0, 1), 'a')
  assert.equal(slice(s, 1, 3), '😀')
  assert.equal(slice(s, 0, 3), 'a😀')
  const fam = '👨‍👩‍👧' // single grapheme, width 2
  assert.equal(slice('x' + fam + 'y', 1, 3), fam)
})

test('combining mark rides with its base char on both boundaries', () => {
  const s = 'éllo' // é(=e+ combining acute, 1 cell) l l o
  // left boundary at cell 1 must include the combining mark, not bare "e"
  assert.equal(slice(s, 0, 1), 'é')
  // right half must NOT re-include the combining mark (no double-count)
  assert.equal(slice(s, 1, 4), 'llo')
  // round-trip: left + right === original (no mark duplicated or lost)
  assert.equal(slice(s, 0, 2) + slice(s, 2, 4), s)
})

test('straddling cut skips a mid-run zero-width char at the start boundary', () => {
  // ZWSP (U+200B) sits exactly at the cut. It belongs to the left half (rides
  // out as a trailing zero-width char), and must NOT reappear in the right half.
  const s = 'ab\u200bcd'
  assert.equal(slice(s, 2, 4), 'cd')
  assert.equal(slice(s, 0, 2), 'ab\u200b')
  assert.equal(slice(s, 0, 2) + slice(s, 2, 4), s) // lossless, no duplicate
})

// --- ANSI byte-identity for non-straddling slices + correct cut for straddling ---

test('styled run: non-straddling slice keeps the full content + style', () => {
  const s = '\x1b[31mhello\x1b[39m'
  // end === full text width → atomic path, unchanged from historical behavior
  assert.equal(slice(s, 0, 5), '\x1b[31mhello\x1b[0m')
  // end undefined → whole string; content + visible width preserved
  const all = slice(s, 0)
  assert.equal(stripAnsi(all), 'hello')
  assert.equal(stringWidth(all), 5)
})

test('styled run: straddling slice now cuts inside the run and re-closes the code', () => {
  const s = '\x1b[31mhello\x1b[39m'
  assert.equal(slice(s, 0, 3), '\x1b[31mhel\x1b[0m')
  assert.equal(slice(s, 2, 5), '\x1b[31mllo\x1b[0m')
})

test('OSC-8 hyperlink token is treated atomically (width 0), not split', () => {
  const link = '\x1b]8;;https://example.com\x1b\\'
  const close = '\x1b]8;;\x1b\\'
  const s = `${link}click${close}`
  // the visible label "click" still slices by cell
  assert.equal(stringWidth(slice(s, 0, 3)), 3)
})

// --- NON-ADDITIVE width oracle (models Bun.stringWidth) — the regression class ---
// Bun.stringWidth is NOT additive over grapheme clusters: an isolated
// emoji-presentation cluster (e.g. "#️") measures 2, but its contribution
// inside a longer string is 1. Summing isolated per-grapheme widths drifts
// `position` and drops the trailing grapheme. naWidth reproduces that exact
// asymmetry deterministically: a cluster containing U+FE0F is width 2 when it
// IS the whole string, width 1 in context.
function naWidth(str) {
  if (str.includes('\x1b')) str = stripAnsi(str)
  const clusters = []
  for (const { segment } of SEG.segment(str)) clusters.push(segment)
  let width = 0
  for (const g of clusters) {
    if (g.includes('\uFE0F')) {
      width += clusters.length === 1 ? 2 : 1
      continue
    }
    for (const ch of g) {
      const cp = ch.codePointAt(0)
      if (!isZeroWidth(cp)) {
        width += eastAsianWidth(cp, { ambiguousAsWide: false })
        break
      }
    }
  }
  return width
}
const naDeps = { stringWidth: naWidth, splitGraphemes }
const naSlice = (s, a, b) => sliceAnsiCore(s, a, b, naDeps)

test('non-additive oracle: a straddling cut never drops the trailing grapheme', () => {
  const s = 'b#️cé' // naWidth(whole)=4, Σ isolated = 5 (the trap)
  assert.equal(naWidth(s), 4)
  // wrap-loop partition at width 2 must tile losslessly (no é lost)
  assert.equal(naSlice(s, 0, 2) + naSlice(s, 2, 4), s)
  // and the visible content of the union is the whole string
  assert.equal(stripAnsi(naSlice(s, 0, 2)) + stripAnsi(naSlice(s, 2, 4)), s)
})

test('non-additive oracle: wrap-loop tiling is lossless across many strings/widths', () => {
  const pieces = ['a', 'b', 'c', '中', '#️', 'é', '😀', 'z']
  let seed = 0x12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let iter = 0; iter < 3000; iter++) {
    const n = Math.floor(rnd() * 8)
    let s = ''
    for (let j = 0; j < n; j++) s += pieces[Math.floor(rnd() * pieces.length)]
    const total = naWidth(s)
    const w = 1 + Math.floor(rnd() * 4)
    // tile the whole string with the same loop terminal.ts wrapText uses
    let pos = 0
    let rebuilt = ''
    let guard = 0
    while (pos < total && guard++ < 1000) {
      rebuilt += naSlice(s, pos, pos + w)
      pos += w
    }
    if (total === 0) rebuilt = naSlice(s, 0, w) // empty/zero-width: single pass
    assert.equal(
      stripAnsi(rebuilt),
      stripAnsi(s),
      `lossy tiling s=${JSON.stringify(s)} w=${w}`,
    )
  }
})

// --- differential vs the pre-change implementation (git HEAD sliceAnsi.ts) ---
// Ported verbatim from HEAD:src/utils/sliceAnsi.ts so we can prove the new leaf
// is byte-identical on slices that don't cut inside a token, and strictly more
// correct on slices that do.
function oldSliceAnsi(str, start, end) {
  const tokens = TOKENIZE(str)
  let activeCodes = []
  let position = 0
  let result = ''
  let include = false
  const isEnd = c => c.code === c.endCode
  const filt = cs => cs.filter(c => !isEnd(c))
  for (const token of tokens) {
    const width =
      token.type === 'ansi' ? 0 : token.fullWidth ? 2 : stringWidth(token.value)
    if (end !== undefined && position >= end) {
      if (token.type === 'ansi' || width > 0 || !include) break
    }
    if (token.type === 'ansi') {
      activeCodes.push(token)
      if (include) result += token.code
    } else {
      if (!include && position >= start) {
        if (start > 0 && width === 0) continue
        include = true
        activeCodes = filt(REDUCE(activeCodes))
        result = TOSTR(activeCodes)
      }
      if (include) result += token.value
      position += width
    }
  }
  result += TOSTR(UNDO(filt(REDUCE(activeCodes))))
  return result
}

test('byte-identical to the old impl when start/end land on token boundaries', () => {
  // multi-run styled strings whose text-token cell boundaries we know exactly
  const cases = [
    ['\x1b[31mhello\x1b[39m', [0, 5]],
    ['\x1b[31mAB\x1b[32mCD\x1b[39m', [0, 2, 4]],
    ['\x1b[1m中文\x1b[22m', [0, 4]],
    ['plain', [0, 5]],
    ['\x1b]8;;https://x.com\x1b\\link\x1b]8;;\x1b\\', [0, 4]],
  ]
  for (const [s, bounds] of cases) {
    for (const a of bounds) {
      for (const b of bounds) {
        if (b < a) continue
        assert.equal(
          slice(s, a, b),
          oldSliceAnsi(s, a, b),
          `boundary slice diverged: ${JSON.stringify(s)} [${a},${b}]`,
        )
      }
      // end === undefined must also match on a start boundary
      assert.equal(slice(s, a), oldSliceAnsi(s, a))
    }
  }
})

test('new impl is strictly more correct than old on a straddling cut', () => {
  const s = '\x1b[31mAB\x1b[32mCD\x1b[39m' // cells: AB[0,2] CD[2,4]
  const newOut = slice(s, 0, 3) // cuts INSIDE the CD token
  assert.notEqual(newOut, oldSliceAnsi(s, 0, 3))
  assert.equal(stringWidth(newOut), 3) // new respects the window
  assert.equal(stringWidth(oldSliceAnsi(s, 0, 3)), 4) // old overshoots
  assert.equal(stripAnsi(newOut), 'ABC')
})

// --- F3: terminal.ts wrap loop now produces N even rows (root fixed in sliceAnsi) ---

test('wrap loop chunks a long single-line run into even rows of the wrap width', () => {
  const line = 'A'.repeat(120)
  const wrapWidth = 30
  const visibleWidth = stringWidth(line)
  const rows = []
  let position = 0
  while (position < visibleWidth) {
    rows.push(slice(line, position, position + wrapWidth))
    position += wrapWidth
  }
  assert.equal(rows.length, 4)
  for (const row of rows) assert.equal(stringWidth(row), 30)
  assert.equal(rows.join(''), line)
})

test('wrap loop on a styled long run keeps each chunk styled and at width', () => {
  const line = '\x1b[32m' + 'x'.repeat(90) + '\x1b[39m'
  const wrapWidth = 30
  const rows = []
  let position = 0
  while (position < 90) {
    rows.push(slice(line, position, position + wrapWidth))
    position += wrapWidth
  }
  assert.equal(rows.length, 3)
  for (const row of rows) assert.equal(stringWidth(row), 30)
})

// --- empty / degenerate windows ---

test('empty and degenerate windows', () => {
  assert.equal(slice('hello', 0, 0), '')
  assert.equal(slice('hello', 2, 2), '')
  assert.equal(slice('', 0, 5), '')
  assert.equal(slice('hello', 10, 20), '') // start past end of string
})

// --- exact ASCII differential fuzz: sliceAnsi must equal String.prototype.slice ---

test('fuzz: pure-ASCII sliceAnsi === String.slice over 4000 random windows', () => {
  // deterministic LCG (no Math.random — reproducible)
  let seed = 0x9e3779b9
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const alphabet = 'abcdefghij ABCDEFG_0123456789'
  for (let i = 0; i < 4000; i++) {
    const len = Math.floor(rnd() * 40)
    let s = ''
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
    const a = Math.floor(rnd() * (len + 2))
    const b = a + Math.floor(rnd() * (len + 2))
    assert.equal(
      slice(s, a, b),
      s.slice(a, b),
      `mismatch s=${JSON.stringify(s)} a=${a} b=${b}`,
    )
  }
})
