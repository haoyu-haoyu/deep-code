import assert from 'node:assert/strict'
import { test } from 'node:test'

import { preserveQuoteStyle } from '../src/tools/FileEditTool/preserveQuoteStyle.mjs'

const LD = '“'
const RD = '”'
const LS = '‘'
const RS = '’'

test('preserveQuoteStyle: an exact match (no quote normalization) returns new_string verbatim', () => {
  assert.equal(preserveQuoteStyle('a "b" c', 'a "b" c', 'x "y" z'), 'x "y" z')
})

test('preserveQuoteStyle: a defensive length mismatch returns new_string verbatim', () => {
  assert.equal(preserveQuoteStyle('abc', LD + 'abc' + RD, 'x"y'), 'x"y')
})

test('preserveQuoteStyle: code/JSON/CLI quotes the model newly wrote are NOT curled (the fix)', () => {
  // file region uses curly quotes around "deploy"; the model's new_string adds a
  // shell flag whose straight quotes MUST stay straight.
  const out = preserveQuoteStyle(
    'Run the "deploy" command.',
    'Run the ' + LD + 'deploy' + RD + ' command.',
    'Run `npm run build --env="prod"` then deploy.',
  )
  assert.equal(out, 'Run `npm run build --env="prod"` then deploy.')
  assert.doesNotMatch(out, /[“”‘’]/, 'no quote in the changed middle is curled')

  // JSON the model writes stays parseable.
  const json = preserveQuoteStyle(
    'set "x" here',
    'set ' + LD + 'x' + RD + ' here',
    'set {"name":"deepcode"} here',
  )
  assert.equal(json, 'set {"name":"deepcode"} here')
  assert.doesNotThrow(() => JSON.parse(json.slice(json.indexOf('{'), json.indexOf('}') + 1)))
})

test('preserveQuoteStyle: a model-new quote that ALIGNS in the shared suffix is NOT curled', () => {
  // Regression: the closing `"` of `--env="prod"` lands in the unchanged ` now`
  // tail and positionally aligns with the file's curly closing quote — a naive
  // prefix/suffix transplant curls it, re-introducing the broken-flag corruption.
  // Condition (a) (the changed middle `--env="prod` contains a quote) blocks it.
  assert.equal(
    preserveQuoteStyle('run "x" now', 'run ' + LD + 'x' + RD + ' now', 'run --env="prod" now'),
    'run --env="prod" now',
  )
  // Prefix-side variant: the model's new opening quote sits after the shared
  // `a "` prefix and must not be curled.
  assert.equal(
    preserveQuoteStyle('a "x" mid', 'a ' + LD + 'x' + RD + ' mid', 'a "env" CHANGED'),
    'a "env" CHANGED',
  )
})

test('preserveQuoteStyle: a changed quote COUNT (added/removed quote) disables curling', () => {
  // Removing a quote (`"hi"` -> `bye"`) leaves a dangling `"` that aligns in the
  // suffix but is NOT a preserved file quote. Condition (b) (per-type quote
  // count must match) blocks it.
  assert.equal(
    preserveQuoteStyle('say "hi"', 'say ' + LD + 'hi' + RD, 'say bye"'),
    'say bye"',
  )
  // Adding a quote pair likewise disables curling (count mismatch).
  assert.equal(
    preserveQuoteStyle('x "1" y', 'x ' + LD + '1' + RD + ' y', 'x "1" "2" y'),
    'x "1" "2" y',
  )
})

test('preserveQuoteStyle: a preserved-context quote gets the file\'s exact curly glyph', () => {
  // The opening and closing quotes are both in the unchanged surrounding context
  // (only the inner word changes), so both take the file's left/right glyph.
  assert.equal(
    preserveQuoteStyle(
      'He said "hello".',
      'He said ' + LD + 'hello' + RD + '.',
      'He said "goodbye".',
    ),
    'He said ' + LD + 'goodbye' + RD + '.',
  )
  // The file's actual left/right choice is transplanted (not guessed by an
  // open/close heuristic): a stray RIGHT double quote before the word is honored.
  assert.equal(
    preserveQuoteStyle('a "x" b', 'a ' + RD + 'x' + RD + ' b', 'a "y" b'),
    'a ' + RD + 'y' + RD + ' b',
  )
})

test('preserveQuoteStyle: single-quote contraction + quotes take the file glyphs in preserved context', () => {
  assert.equal(
    preserveQuoteStyle("it's 'a'", 'it' + RS + 's ' + LS + 'a' + RS, "it's 'b'"),
    'it' + RS + 's ' + LS + 'b' + RS,
  )
})

test('preserveQuoteStyle: a fully-rewritten new_string (no shared prefix/suffix) is never curled', () => {
  // No common prefix/suffix → nothing is preserved → straight quotes kept.
  assert.equal(
    preserveQuoteStyle('"old"', LD + 'old' + RD, 'completely "new" text'),
    'completely "new" text',
  )
})

test('preserveQuoteStyle: ASCII edits with no curly in the file region are untouched', () => {
  // oldString !== actualOldString but the file region has no curly quote → the
  // transplant finds nothing to restore.
  assert.equal(
    preserveQuoteStyle('a"b', 'a"b ', 'x"y'), // trailing-space difference, no curly
    'x"y',
  )
})
