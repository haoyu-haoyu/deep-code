import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizePastedText } from '../src/components/PromptInput/normalizePastedText.mjs'

// The exact pre-fix CR handling, as a differential oracle.
const oldNormalize = text => text.replace(/\r/g, '\n').replaceAll('\t', '    ')

test('THE FIX: CRLF collapses to a single newline (no blank line between lines)', () => {
  assert.equal(
    normalizePastedText('line1\r\nline2\r\nline3'),
    'line1\nline2\nline3',
  )
  // the old expression doubled every CRLF into a blank line:
  assert.equal(
    oldNormalize('line1\r\nline2\r\nline3'),
    'line1\n\nline2\n\nline3',
  )
  assert.notEqual(
    normalizePastedText('line1\r\nline2'),
    oldNormalize('line1\r\nline2'),
  )
})

test('a lone classic-Mac CR becomes one newline', () => {
  assert.equal(normalizePastedText('a\rb\rc'), 'a\nb\nc')
})

test('a lone LF is unchanged', () => {
  assert.equal(normalizePastedText('a\nb\nc'), 'a\nb\nc')
})

test('tabs expand to 4 spaces (unchanged behavior)', () => {
  assert.equal(normalizePastedText('a\tb'), 'a    b')
  assert.equal(normalizePastedText('\tindent'), '    indent')
})

test('mixed CRLF / lone CR / LF / tab', () => {
  assert.equal(normalizePastedText('a\r\nb\tc\rd\ne'), 'a\nb    c\nd\ne')
})

test('text with no line endings or tabs is unchanged', () => {
  assert.equal(normalizePastedText('hello world'), 'hello world')
  assert.equal(normalizePastedText(''), '')
})

test('the resulting line count is no longer doubled for CRLF paste', () => {
  // 30 CRLF-joined lines -> 30 logical lines (was ~58 because of the blank lines)
  const text = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\r\n')
  const normalized = normalizePastedText(text)
  const count = (normalized.match(/\r\n|\r|\n/g) || []).length + 1
  assert.equal(count, 30)
  const oldCount = (oldNormalize(text).match(/\r\n|\r|\n/g) || []).length + 1
  assert.equal(oldCount, 59) // 29 real + 29 inserted blank-line breaks + 1
})
