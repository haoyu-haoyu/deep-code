import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  processEarlyInputChunk,
  skipEscapeSequence,
} from '../src/utils/earlyInputChunk.mjs'

const ESC = String.fromCharCode(27)
// A simple last-grapheme for the injected dependency (ASCII backspace tests only).
const lastGrapheme = s => Array.from(s).at(-1) ?? ''

// What ends up in the buffer for a chunk typed into an empty early buffer.
const buf = str => processEarlyInputChunk('', str, lastGrapheme).buffer

// The exact pre-fix escape skip, as a differential oracle.
function oldSkip(str, i) {
  i++ // past ESC
  while (i < str.length && !(str.charCodeAt(i) >= 64 && str.charCodeAt(i) <= 126)) {
    i++
  }
  if (i < str.length) i++
  return i
}

test('THE BUG: arrow keys no longer leak letters into the buffer', () => {
  assert.equal(buf(ESC + '[A'), '') // up
  assert.equal(buf(ESC + '[B'), '') // down
  assert.equal(buf(ESC + '[C'), '') // right
  assert.equal(buf(ESC + '[D'), '') // left
  // typed text around an arrow key survives, the arrow contributes nothing
  assert.equal(buf('fix' + ESC + '[A'), 'fix')
  assert.equal(buf('a' + ESC + '[A' + 'b'), 'ab')
  // the old skip leaked the final byte as a letter
  assert.equal(oldLeak(ESC + '[A'), 'A')
})

test('THE BUG: a bracketed paste no longer leaks its 200~/201~ marker digits', () => {
  // ESC[200~ hello ESC[201~  ->  "hello"
  assert.equal(buf(ESC + '[200~' + 'hello' + ESC + '[201~'), 'hello')
  assert.equal(oldLeak(ESC + '[200~' + 'hi' + ESC + '[201~'), '200~hi201~')
})

test('CSI with parameters and focus events are fully skipped', () => {
  assert.equal(buf(ESC + '[H'), '') // Home
  assert.equal(buf(ESC + '[15~'), '') // F5
  assert.equal(buf(ESC + '[1;5C'), '') // Ctrl+Right
  assert.equal(buf(ESC + '[I'), '') // focus in
  assert.equal(buf(ESC + '[O'), '') // focus out
  assert.equal(buf(ESC + '[?25h'), '') // private-mode set
})

test('SS3 sequences (ESC O P/Q/R/S = F1-F4, and arrows) are fully skipped', () => {
  assert.equal(buf(ESC + 'OP'), '')
  assert.equal(buf(ESC + 'OA'), '')
  assert.equal(buf('x' + ESC + 'OP' + 'y'), 'xy')
})

test('Alt+key (ESC + letter, no CSI/SS3 introducer) behaves as before (consumes the letter)', () => {
  // unchanged from the old skip: ESC then a single 0x40-0x7E byte
  assert.equal(buf(ESC + 'a'), '')
  assert.equal(skipEscapeSequence(ESC + 'a', 0), oldSkip(ESC + 'a', 0))
  assert.equal(skipEscapeSequence(ESC + 'b', 0), oldSkip(ESC + 'b', 0))
})

test('printable typing, tab, CR->LF, and other control chars', () => {
  assert.equal(buf('hello world'), 'hello world')
  assert.equal(buf('a\tb'), 'a\tb') // tab preserved
  assert.equal(buf('a\rb'), 'a\nb') // CR -> LF
  assert.equal(buf('a\nb'), 'a\nb') // LF preserved
  assert.equal(buf('a' + String.fromCharCode(7) + 'b'), 'ab') // BEL skipped
})

test('backspace removes the last char; Ctrl+C/Ctrl+D signal and stop', () => {
  assert.equal(buf('abc' + String.fromCharCode(127)), 'ab')
  assert.equal(buf('abc' + String.fromCharCode(8)), 'ab')
  const sigint = processEarlyInputChunk('hi', 'x' + String.fromCharCode(3) + 'ignored', lastGrapheme)
  assert.equal(sigint.control, 'sigint')
  assert.equal(sigint.buffer, 'hix') // processed up to Ctrl+C, rest discarded
  const eof = processEarlyInputChunk('hi', String.fromCharCode(4) + 'ignored', lastGrapheme)
  assert.equal(eof.control, 'eof')
  assert.equal(eof.buffer, 'hi')
})

test('a chunk with no ESC is identical to the old folding (no regression)', () => {
  for (const s of ['plain text', 'tabs\tand\tstuff', 'multi\nline\ninput', '']) {
    assert.equal(buf(s), s.replace(/\r/g, '\n'))
  }
})

// helper: reconstruct what the OLD escape skip would have leaked into the buffer,
// reusing the real non-escape folding via a tiny faithful loop.
function oldLeak(str) {
  let out = ''
  let i = 0
  while (i < str.length) {
    const code = str.charCodeAt(i)
    if (code === 27) {
      i = oldSkip(str, i)
      continue
    }
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      i++
      continue
    }
    if (code === 13) {
      out += '\n'
      i++
      continue
    }
    out += str[i]
    i++
  }
  return out
}
