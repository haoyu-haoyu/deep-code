import { test } from 'node:test'
import assert from 'node:assert/strict'

import clusterStyledChars from '../src/ink/clusterStyledChars.core.mjs'

// Self-contained harness (no vendored ansi-tokenize): a local grapheme segmenter,
// a simple width fn, array-equality for styles. The EXACT width values don't matter
// to the invariant — both the leaf and the oracle use the same fn over the same
// graphemes; what matters is that the leaf segments the WHOLE line.
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
const segment = s => seg.segment(s)
// Cluster-aware (one value per grapheme, like the real stringWidth): a grapheme
// carrying an emoji / regional indicator / VS16 base renders as a single width-2
// cell; otherwise sum the non-zero-width code points (CJK = 2, combining = 0).
function width(g) {
  for (const ch of g) {
    const cp = ch.codePointAt(0)
    if (
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
      cp === 0xfe0f
    ) {
      return 2
    }
  }
  let w = 0
  for (const ch of g) {
    const cp = ch.codePointAt(0)
    if (cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) {
      continue // zero-width glue
    }
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3)
    ) {
      w += 2
      continue
    }
    w += 1
  }
  return w
}
const stylesEqual = (a, b) => a.length === b.length && a.every((s, i) => s === b[i])

// Build a tokenized StyledChar[] (one entry per code point) from a plain string,
// with `styleAt(codePointIndex)` choosing each code point's styles array.
function toStyledChars(plain, styleAt) {
  const chars = []
  let i = 0
  for (const ch of plain) {
    chars.push({ value: ch, styles: styleAt(i) })
    i += 1
  }
  return chars
}

test('a grapheme straddling a style boundary stays ONE unit (❤ + VS16 split)', () => {
  // The repro: style code emitted between the base and its VS16.
  const chars = toStyledChars('❤️', i => (i === 0 ? ['red'] : ['reset']))
  const { graphemes } = clusterStyledChars(chars, { segment, width, stylesEqual })
  assert.equal(graphemes.length, 1, 'one grapheme, not two')
  assert.equal(graphemes[0].value, '❤️')
  assert.equal(graphemes[0].width, 2)
})

test('a ZWJ family with a mid-cluster style code stays one grapheme', () => {
  const fam = '👨‍👩‍👧'
  const chars = toStyledChars(fam, i => (i === 0 ? ['a'] : ['b'])) // code after the base
  const { graphemes } = clusterStyledChars(chars, { segment, width, stylesEqual })
  assert.equal(graphemes.length, 1)
  assert.equal(graphemes[0].value, fam)
  assert.equal(graphemes[0].width, 2)
})

test('a grapheme takes the style of its FIRST code point', () => {
  const chars = toStyledChars('❤️', i => (i === 0 ? ['first'] : ['second']))
  const { graphemes, runStyles } = clusterStyledChars(chars, { segment, width, stylesEqual })
  assert.deepEqual(runStyles, [['first']])
  assert.equal(graphemes[0].runIndex, 0)
})

test('runs coalesce adjacent equal styles and split on change', () => {
  const chars = toStyledChars('abc', i => (i < 2 ? ['x'] : ['y']))
  const { graphemes, runStyles } = clusterStyledChars(chars, { segment, width, stylesEqual })
  assert.equal(runStyles.length, 2)
  assert.deepEqual(graphemes.map(g => g.runIndex), [0, 0, 1])
  assert.deepEqual(graphemes.map(g => g.value), ['a', 'b', 'c'])
})

test('empty input → empty result', () => {
  const { graphemes, runStyles } = clusterStyledChars([], { segment, width, stylesEqual })
  assert.deepEqual(graphemes, [])
  assert.deepEqual(runStyles, [])
})

test('invariant fuzz: leaf graphemes == whole-line segmentation, regardless of style splits', () => {
  const alphabet = [
    'a', 'b', '世', '界', '👨', '👩', '👧', '❤', '‍', '️',
    '́', '🇺', '🇸', '🏽',
  ]
  let s = 0x9e3779b9 >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  for (let iter = 0; iter < 20000; iter++) {
    let plain = ''
    const n = (rnd() * 12) | 0
    for (let k = 0; k < n; k++) plain += alphabet[(rnd() * alphabet.length) | 0]
    // random styles per code point (this is where a mid-cluster split happens)
    const chars = toStyledChars(plain, () => [String((rnd() * 3) | 0)])
    const { graphemes } = clusterStyledChars(chars, { segment, width, stylesEqual })

    // (1) the leaf's graphemes are EXACTLY the whole-line segmentation
    const expected = [...segment(plain)].map(x => x.segment)
    assert.deepEqual(
      graphemes.map(g => g.value),
      expected,
      `iter ${iter}: ${JSON.stringify(plain)}`,
    )
    // (2) Σ(grapheme width) === width(whole line) — the invariant layout relies on
    const sumWidth = graphemes.reduce((a, g) => a + g.width, 0)
    const lineWidth = expected.reduce((a, g) => a + width(g), 0)
    assert.equal(sumWidth, lineWidth, `iter ${iter}: width sum`)
    // (3) every runIndex is valid
    for (const g of graphemes) assert.ok(g.runIndex >= 0, `iter ${iter}: runIndex`)
  }
})

test('differential vs OLD per-run clustering: identical when styles change only at grapheme boundaries', () => {
  // OLD behavior: re-cluster graphemes inside each style run.
  function oldCluster(chars) {
    const out = []
    const buf = []
    let bufStyles = chars[0]?.styles
    const flush = (str, styles) => {
      for (const { segment: g } of segment(str)) out.push({ value: g, styles })
    }
    for (const c of chars) {
      if (buf.length > 0 && !stylesEqual(c.styles, bufStyles)) {
        flush(buf.join(''), bufStyles)
        buf.length = 0
      }
      buf.push(c.value)
      bufStyles = c.styles
    }
    if (buf.length > 0) flush(buf.join(''), bufStyles)
    return out
  }
  for (const plain of ['hello', 'a世b界', '👨a👩b❤c', 'x😀y']) {
    // assign each code point the style of the GRAPHEME it belongs to → no mid-cluster split
    const styleByOffset = new Map()
    let off = 0
    let gi = 0
    for (const { segment: g } of segment(plain)) {
      for (let k = 0; k < g.length; k++) styleByOffset.set(off + k, [String(gi % 2)])
      off += g.length
      gi += 1
    }
    const chars = []
    let o = 0
    for (const ch of plain) {
      chars.push({ value: ch, styles: styleByOffset.get(o) })
      o += ch.length
    }
    const oldOut = oldCluster(chars)
    const { graphemes } = clusterStyledChars(chars, { segment, width, stylesEqual })
    assert.deepEqual(
      graphemes.map(g => g.value),
      oldOut.map(o => o.value),
      `old/new grapheme values differ for ${JSON.stringify(plain)}`,
    )
  }
})
