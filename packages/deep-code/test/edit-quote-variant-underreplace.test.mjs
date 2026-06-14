import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countMissedQuoteVariants } from '../src/tools/FileEditTool/quoteVariantUnderReplace.mjs'

// curly glyphs, matching utils.ts constants
const LD = '“'
const RD = '”'
const LS = '‘'
const RS = '’'

// Mirror normalizeQuotes (utils.ts): each curly quote → one straight ASCII char.
// Length-preserving, which is what makes the split-count comparison valid.
const normalize = s =>
  s.replaceAll(LD, '"').replaceAll(RD, '"').replaceAll(LS, "'").replaceAll(RS, "'")

test('all-straight file with one match → nothing missed', () => {
  assert.equal(countMissedQuoteVariants('a "foo" b', '"foo"', normalize), 0)
})

test('all-CURLY file, curly actualOldString → nothing missed (counts agree)', () => {
  // A smart-quote doc where every occurrence shares the same curly style: a
  // replace_all on that exact curly variant covers them all. No false positive.
  const file = `x ${LD}foo${RD} y ${LD}foo${RD} z`
  assert.equal(countMissedQuoteVariants(file, `${LD}foo${RD}`, normalize), 0)
})

test('MIXED styles: straight variant matched, one curly sibling missed', () => {
  const file = `a ${LD}foo${RD} b "foo" c`
  // actualOldString is the straight variant (findActualString exact-match-first)
  assert.equal(countMissedQuoteVariants(file, '"foo"', normalize), 1)
})

test('MIXED styles: two curly siblings missed when straight matched', () => {
  const file = `${LD}foo${RD} "foo" ${LD}foo${RD}`
  assert.equal(countMissedQuoteVariants(file, '"foo"', normalize), 2)
})

test('MIXED styles: curly variant matched, straight sibling missed (symmetric)', () => {
  const file = `${LD}foo${RD} and "foo"`
  assert.equal(countMissedQuoteVariants(file, `${LD}foo${RD}`, normalize), 1)
})

test('token with no quotes → identity normalize → never a false positive', () => {
  const file = 'foo bar foo baz foo'
  assert.equal(countMissedQuoteVariants(file, 'foo', normalize), 0)
})

test('empty actualOldString → 0 (no spurious work)', () => {
  assert.equal(countMissedQuoteVariants('anything', '', normalize), 0)
})

test('single occurrence, single style → 0 missed', () => {
  assert.equal(countMissedQuoteVariants(`only ${LD}one${RD} here`, `${LD}one${RD}`, normalize), 0)
})

test('mixed single-quote styles are detected too', () => {
  const file = `${LS}x${RS} 'x'`
  assert.equal(countMissedQuoteVariants(file, "'x'", normalize), 1)
})

// Reviewer repros — OVERLAP must not phantom-count. A naive normalized−literal
// split-delta over-counts when normalized occurrences overlap on a shared char;
// the simulate-then-recount approach returns 0 because a real replaceAll
// consumes the shared char and leaves no genuine sibling.
test('overlap (B repro): "" against a curly-glued run leaves no genuine sibling', () => {
  // `msg = “"""` → actualOldString '""'; real replaceAll('""') → no '"" ' remains.
  assert.equal(countMissedQuoteVariants(`msg = ${LD}"""`, '""', normalize), 0)
})

test('overlap (A repro): content-bearing b"b against b“b"b“b’ leaves no sibling', () => {
  // The curly "b…b" regions overlap the literal b"b on the shared b's; replacing
  // the literal consumes them, so nothing different-style survives.
  const file = `b${LD}b"b${LD}b${RS}`
  assert.equal(countMissedQuoteVariants(file, 'b"b', normalize), 0)
})

test('all-quote needle WITH a real non-overlapping sibling IS counted', () => {
  // A straight "" and a separate curly “” — the curly one genuinely survives a
  // replaceAll('""'), so it must be reported (no blanket skip of quote needles).
  assert.equal(countMissedQuoteVariants(`x "" y ${LD}${RD} z`, '""', normalize), 1)
})

test('lone quote needle with surviving curly siblings is counted correctly', () => {
  // replace_all('"') rewrites the straight quotes; the curly “c” normalizes to
  // "c" — two surviving straight-quote-equivalents.
  assert.equal(countMissedQuoteVariants(`"x" ${LD}c${RD}`, '"', normalize), 2)
})

test('a content-bearing needle that also contains quotes is counted', () => {
  const file = `${LD}a${RD} "a"`
  assert.equal(countMissedQuoteVariants(file, '"a"', normalize), 1)
})

test('overlapping siblings are counted NON-overlapping, like a real replaceAll', () => {
  // normalize(“”“) = """ — three quotes. A replace_all can only consume two of
  // them as one `""`, leaving one; so exactly ONE different-style sibling is
  // missed, not two. (Counting overlaps would wrongly report 2.)
  assert.equal(countMissedQuoteVariants(`${LD}${RD}${LD}`, '""', normalize), 1)
})
