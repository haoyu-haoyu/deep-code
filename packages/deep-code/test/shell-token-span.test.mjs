import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, quote } from 'shell-quote'

import {
  quotedTokenStart,
  escapeFileCompletion,
} from '../src/utils/bash/shellTokenSpan.mjs'

// Adapter mirroring tryParseShellCommand's { success, tokens } shape.
const tryParse = s => ({ success: true, tokens: parse(s) })

// The pre-fix replace span (naive lastIndexOf(' ')+1), as a differential oracle.
const oldWordStart = beforeCursor => beforeCursor.lastIndexOf(' ') + 1

test('quotedTokenStart finds the raw start of a backslash-escaped token', () => {
  const beforeCursor = 'cat my\\ fil'
  const prefix = parse(beforeCursor).at(-1) // "my fil"
  assert.equal(prefix, 'my fil')
  const start = quotedTokenStart(beforeCursor, prefix, tryParse)
  assert.equal(start, 4) // the 'm' of "my\ fil"
  // the naive old span landed inside the token (after the escaped space):
  assert.notEqual(start, oldWordStart(beforeCursor))
  // re-parsing from the found start yields exactly the token:
  assert.deepEqual(parse(beforeCursor.slice(start)), [prefix])
})

test('quotedTokenStart finds the opening quote of a single/double-quoted token', () => {
  for (const beforeCursor of ["cat 'my fil'", 'cat "my fil"']) {
    const prefix = parse(beforeCursor).at(-1)
    assert.equal(prefix, 'my fil')
    const start = quotedTokenStart(beforeCursor, prefix, tryParse)
    assert.equal(start, 4) // the opening quote
    assert.deepEqual(parse(beforeCursor.slice(start)), [prefix])
  }
})

test('quotedTokenStart handles a path with an escaped space and multiple leading spaces', () => {
  const beforeCursor = 'ls   ./a\\ b'
  const prefix = parse(beforeCursor).at(-1) // "./a b"
  const start = quotedTokenStart(beforeCursor, prefix, tryParse)
  assert.deepEqual(parse(beforeCursor.slice(start)), [prefix])
  assert.equal(beforeCursor.slice(start), './a\\ b')
})

test('FUZZ: quotedTokenStart returns a start whose suffix re-parses to exactly the token', () => {
  const names = ['my file', 'a b c', "it's", 'na"me', 'two  spaces', 'plain']
  const quoters = [
    n => n.replace(/ /g, '\\ ').replace(/"/g, '\\"'), // backslash-escape (skip if it has a quote char that complicates)
    n => "'" + n.replace(/'/g, "'\\''") + "'", // single-quote
    n => '"' + n.replace(/(["\\])/g, '\\$1') + '"', // double-quote
  ]
  const leads = ['cat ', 'ls   ', 'grep -n foo ', 'echo a ']
  let checked = 0
  for (const name of names) {
    for (const q of quoters) {
      let raw
      try {
        raw = q(name)
      } catch {
        continue
      }
      // Only test quotings that validly round-trip to the name (a malformed quote
      // would never reach quotedTokenStart in production — the whole-line parse
      // must succeed first).
      const rt = parse(raw)
      if (rt.length !== 1 || rt[0] !== name) continue
      for (const lead of leads) {
        const beforeCursor = lead + raw
        const parsed = parse(beforeCursor)
        const last = parsed.at(-1)
        if (typeof last !== 'string') continue // operator tail, skip
        const start = quotedTokenStart(beforeCursor, last, tryParse)
        // The suffix from `start` must parse to exactly the single last token.
        assert.deepEqual(parse(beforeCursor.slice(start)), [last], `${beforeCursor} | start=${start}`)
        // And `start` must be a token boundary: the char before it is whitespace or it's 0.
        assert.ok(start === 0 || /\s/.test(beforeCursor[start - 1]), `${beforeCursor} start=${start} not at boundary`)
        checked++
      }
    }
  }
  assert.ok(checked > 20, `expected many fuzz checks, got ${checked}`)
})

test('escapeFileCompletion: clean names pass through unchanged (byte-identical to the old raw insert)', () => {
  assert.equal(escapeFileCompletion('file.txt ', quote), 'file.txt ')
  assert.equal(escapeFileCompletion('src/', quote), 'src/')
  assert.equal(escapeFileCompletion('a-b_c.1.txt ', quote), 'a-b_c.1.txt ')
})

test('escapeFileCompletion: a space-bearing path is quoted, keeping the trailing separator', () => {
  // file: trailing space is the separator (stays outside the quotes)
  assert.equal(escapeFileCompletion('my file.txt ', quote), "'my file.txt' ")
  // dir: trailing slash is part of the path (stays inside)
  assert.equal(escapeFileCompletion('my dir/', quote), "'my dir/'")
})

test('end-to-end: completing an escaped-space token no longer duplicates the fragment', () => {
  // Simulate applyShellSuggestion's file branch: replace [replaceStart, cursor)
  // with the escaped displayText.
  const input = 'cat my\\ fil'
  const cursorOffset = input.length
  const beforeCursor = input.slice(0, cursorOffset)
  const prefix = parse(beforeCursor).at(-1)
  const replaceStart = quotedTokenStart(beforeCursor, prefix, tryParse)
  const replacement = escapeFileCompletion('my file.txt ', quote)
  const newInput = input.slice(0, replaceStart) + replacement + input.slice(cursorOffset)
  assert.equal(newInput, "cat 'my file.txt' ") // one argument, no duplication
  // the old span would have produced the broken duplicated form:
  const oldStart = oldWordStart(beforeCursor)
  const oldInput = input.slice(0, oldStart) + 'my file.txt ' + input.slice(cursorOffset)
  assert.equal(oldInput, 'cat my\\ my file.txt ')
  assert.notEqual(newInput, oldInput)
})
