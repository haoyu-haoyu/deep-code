import { test } from 'node:test'
import assert from 'node:assert/strict'

import { safeAnalyticsMimeType } from '../src/utils/safeAnalyticsMimeType.mjs'

test('a well-formed media type passes through (params stripped, lowercased)', () => {
  assert.equal(safeAnalyticsMimeType('application/pdf'), 'application/pdf')
  assert.equal(
    safeAnalyticsMimeType('application/pdf; charset=utf-8'),
    'application/pdf',
  )
  assert.equal(safeAnalyticsMimeType('IMAGE/PNG'), 'image/png')
  assert.equal(
    safeAnalyticsMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
})

test('empty / missing / non-string → unknown', () => {
  assert.equal(safeAnalyticsMimeType(''), 'unknown')
  assert.equal(safeAnalyticsMimeType('   '), 'unknown')
  assert.equal(safeAnalyticsMimeType(undefined), 'unknown')
  assert.equal(safeAnalyticsMimeType(null), 'unknown')
  assert.equal(safeAnalyticsMimeType(42), 'unknown')
})

test('THE FIX: a malicious / garbage Content-Type collapses to "other" (never egressed verbatim)', () => {
  // injected text / not a media type
  assert.equal(safeAnalyticsMimeType('not a mime type at all'), 'other')
  assert.equal(safeAnalyticsMimeType('application'), 'other') // no subtype
  assert.equal(safeAnalyticsMimeType('/png'), 'other') // empty type
  assert.equal(safeAnalyticsMimeType('image/'), 'other') // empty subtype
  // an oversized header is bounded out
  assert.equal(safeAnalyticsMimeType('a/' + 'x'.repeat(200)), 'other')
  // a header carrying injected punctuation / path-like content
  assert.equal(safeAnalyticsMimeType('text/html<script>/../etc/passwd'), 'other')
  // params are stripped first, so a benign type with a garbage param is still safe
  assert.equal(
    safeAnalyticsMimeType('text/plain; boundary=../../secret'),
    'text/plain',
  )
})
