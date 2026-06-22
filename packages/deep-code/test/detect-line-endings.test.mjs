import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectLineEndingsForString } from '../src/utils/detectLineEndings.mjs'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const CRLF = CR + LF

test('plain LF / CRLF / majority vote', () => {
  assert.equal(detectLineEndingsForString('a' + LF + 'b' + LF + 'c'), 'LF')
  assert.equal(detectLineEndingsForString('a' + CRLF + 'b' + CRLF + 'c'), 'CRLF')
  // mixed: more CRLF than lone-LF -> CRLF
  assert.equal(
    detectLineEndingsForString('a' + CRLF + 'b' + CRLF + 'c' + LF + 'd'),
    'CRLF',
  )
  // mixed: more lone-LF than CRLF -> LF
  assert.equal(
    detectLineEndingsForString('a' + LF + 'b' + LF + 'c' + CRLF + 'd'),
    'LF',
  )
})

test('ties and empties resolve to LF (strict-majority CRLF preserved)', () => {
  assert.equal(detectLineEndingsForString(''), 'LF')
  assert.equal(detectLineEndingsForString('no newlines'), 'LF')
  // 1 CRLF vs 1 LF is a tie -> LF
  assert.equal(detectLineEndingsForString('a' + CRLF + 'b' + LF + 'c'), 'LF')
})

test('a lone CR (not followed by LF) is ignored', () => {
  // only lone CRs, no LF -> 0/0 -> LF
  assert.equal(detectLineEndingsForString('a' + CR + 'b' + CR + 'c'), 'LF')
  // CR-CR-LF: the LF is preceded by a CR -> counts as one CRLF
  assert.equal(detectLineEndingsForString('a' + CR + CRLF + 'b'), 'CRLF')
})

test('THE FIX: a CRLF file with a >4096-char first line is detected CRLF over the full content, but a 4096-char prefix misdetects it as LF', () => {
  // first line: 5000 ASCII chars with NO newline, then several CRLF data lines
  const longFirstLine = 'x'.repeat(5000)
  const content =
    longFirstLine + CRLF + 'row1' + CRLF + 'row2' + CRLF + 'row3' + CRLF

  // full content: the CRLF rows win -> CRLF (correct)
  assert.equal(detectLineEndingsForString(content), 'CRLF')

  // the old buggy behavior: a 4096-char prefix sits entirely inside the first
  // line, contains no '\n', votes 0/0 -> 'LF' -> write would flip the whole
  // file's CRLFs to LF
  assert.equal(detectLineEndingsForString(content.slice(0, 4096)), 'LF')
})

test('the reverse: a mostly-LF file with a CRLF-heavy first 4096 chars is also correctly resolved over the full content', () => {
  // a CRLF banner that fills well past the first 4096 chars, then a long LF body
  const banner = ('a' + CRLF).repeat(1500) // 4500 chars, 1500 CRLF
  const body = ('b' + LF).repeat(2000) // 2000 lone-LF
  const content = banner + body
  // full content: lone-LF (2000) > CRLF (1500) -> LF (correct)
  assert.equal(detectLineEndingsForString(content), 'LF')
  // a 4096-char prefix is CRLF-dominated -> would have misdetected CRLF
  assert.equal(detectLineEndingsForString(content.slice(0, 4096)), 'CRLF')
})
