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
