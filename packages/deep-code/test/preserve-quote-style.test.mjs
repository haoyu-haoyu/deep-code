import assert from 'node:assert/strict'
import { test } from 'node:test'

import { preserveQuoteStyle } from '../src/tools/FileEditTool/preserveQuoteStyle.mjs'

const LD = '“'
const RD = '”'
const LS = '‘'
const RS = '’'

// preserveQuoteStyle is intentionally a no-op: it returns new_string verbatim.
// Restoring a file's curly-quote typography onto an edit cannot be done without
// risking corruption of code/JSON/shell the model newly wrote, because the model
// emits all quotes straight and there is no reliable way to tell a preserved
// quote from a model-introduced one. These tests lock in the no-op so a future
// change that re-introduces curling (and the corruption it caused) is caught.

test('preserveQuoteStyle returns new_string verbatim and never curls a model quote', () => {
  // The corruption cases from review: a shell flag, JSON, and a CLI subscript
  // the model newly wrote must reach disk byte-identical (straight quotes).
  for (const [oldStr, fileStr, newStr] of [
    // the original "curl everything" corruption
    ['Run the "x" command.', 'Run the ' + LD + 'x' + RD + ' command.', 'Run `build --env="prod"` now.'],
    // prefix/suffix-transplant corruption: a model-new quote aligned in the tail
    ['run "x" now', 'run ' + LD + 'x' + RD + ' now', 'run --env="prod" now'],
    ['a "x" mid', 'a ' + LD + 'x' + RD + ' mid', 'a "env" CHANGED'],
    // greedy-suffix boundary absorption
    ["x' '", 'x' + RS + ' ' + RS, "abc' '"],
    ["b'=x='", 'b' + RS + '=x=' + RS, "abc'=x='"],
    // a quote added/removed
    ['say "hi"', 'say ' + LD + 'hi' + RD, 'say bye"'],
    // JSON
    ['set "x" here', 'set ' + LD + 'x' + RD + ' here', 'set {"k":"v"} here'],
  ]) {
    assert.equal(
      preserveQuoteStyle(oldStr, fileStr, newStr),
      newStr,
      `must return new_string verbatim for ${JSON.stringify(newStr)}`,
    )
    assert.doesNotMatch(
      preserveQuoteStyle(oldStr, fileStr, newStr),
      /[“”‘’]/,
      'no curly quote is ever introduced',
    )
  }
})

test('preserveQuoteStyle does not curl even a pure prose edit (curly restoration is disabled)', () => {
  // The trade-off: a curly-quote prose file edited by the model gets straight
  // quotes in the edited span. Harmless (the surrounding file keeps its curly
  // quotes); the alternative — selective curling — provably corrupts code.
  assert.equal(
    preserveQuoteStyle('He said "hello".', 'He said ' + LD + 'hello' + RD + '.', 'He said "goodbye".'),
    'He said "goodbye".',
  )
  assert.equal(
    preserveQuoteStyle("it's 'a'", 'it' + RS + 's ' + LS + 'a' + RS, "it's 'b'"),
    "it's 'b'",
  )
})

test('preserveQuoteStyle leaves a no-curly / exact-match edit unchanged too', () => {
  assert.equal(preserveQuoteStyle('a "b" c', 'a "b" c', 'x "y" z'), 'x "y" z')
  assert.equal(preserveQuoteStyle('plain', 'plain', 'other'), 'other')
})
