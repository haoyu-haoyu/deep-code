import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripOscControlChars } from '../src/ink/termio/stripOscControlChars.mjs'

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const ST = ESC + '\\'

test('a clean http(s) URL passes through byte-identical', () => {
  const url = 'https://docs.example.com/a/b?c=1&d=2#frag'
  assert.equal(stripOscControlChars(url), url)
})

test('a file:// URL with percent-encoded bytes is unchanged', () => {
  const url = 'file:///Users/me/a%20b/%1Bnot-an-escape'
  // %1B is the three inert chars '%','1','B' — NOT a control byte — so it stays.
  assert.equal(stripOscControlChars(url), url)
})

test('THE FIX: an embedded ESC + CSI break-out is removed', () => {
  const evil = 'https://x.com' + ESC + '[2J' + BEL
  const out = stripOscControlChars(evil)
  assert.ok(!out.includes(ESC), 'ESC must be stripped')
  assert.ok(!out.includes(BEL), 'BEL must be stripped')
  assert.equal(out, 'https://x.com[2J') // the printable remnant is inert as a URL
})

test('a bare ST (ESC backslash) is removed', () => {
  const out = stripOscControlChars('https://x.com' + ST)
  assert.ok(!out.includes(ESC))
})

test('strips all C0, DEL, and C1 control characters', () => {
  for (let c = 0x00; c <= 0x1f; c++) {
    assert.equal(stripOscControlChars('a' + String.fromCharCode(c) + 'b'), 'ab')
  }
  assert.equal(stripOscControlChars('a' + String.fromCharCode(0x7f) + 'b'), 'ab')
  for (let c = 0x80; c <= 0x9f; c++) {
    assert.equal(stripOscControlChars('a' + String.fromCharCode(c) + 'b'), 'ab')
  }
})

test('printable and non-control unicode are preserved', () => {
  assert.equal(stripOscControlChars('café — 日本語 — 🚀'), 'café — 日本語 — 🚀')
  // U+00A0 (NBSP, 0xA0) is just above C1 and is preserved
  assert.equal(
    stripOscControlChars('a' + String.fromCharCode(0xa0) + 'b'),
    'a' + String.fromCharCode(0xa0) + 'b',
  )
})

test('non-string input passes through untouched', () => {
  assert.equal(stripOscControlChars(undefined), undefined)
  assert.equal(stripOscControlChars(null), null)
  assert.equal(stripOscControlChars(42), 42)
})

test('an all-control URL collapses to empty (neutralized)', () => {
  assert.equal(stripOscControlChars(ESC + BEL + String.fromCharCode(0x00)), '')
})
