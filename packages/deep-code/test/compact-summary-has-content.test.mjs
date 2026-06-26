import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compactSummaryHasContent } from '../src/services/compact/compactSummaryHasContent.mjs'

// The input is the output of formatCompactSummary (prompt.ts), which unwraps
// <summary>body</summary> into "Summary:\n<body>" and strips <analysis>. The
// comments below note which raw model response produces each formatted string.

test('a real summary has content', () => {
  // <analysis>...</analysis><summary>1. Primary Request...</summary>
  assert.equal(
    compactSummaryHasContent('Summary:\n1. Primary Request and Intent: ...'),
    true,
  )
})

test('empty string has no content (response truncated before the <summary> tag)', () => {
  // <analysis>thinking...  (cut off by max_tokens, no <summary> at all)
  // -> formatCompactSummary strips analysis -> ""
  assert.equal(compactSummaryHasContent(''), false)
})

test('bare "Summary:" header has no content (empty <summary></summary>)', () => {
  // <analysis>x</analysis><summary></summary> -> "Summary:"
  assert.equal(compactSummaryHasContent('Summary:'), false)
})

test('"Summary:" header with only whitespace body has no content', () => {
  // <analysis>x</analysis><summary>   </summary> -> "Summary:" (body trimmed)
  assert.equal(compactSummaryHasContent('Summary:\n   '), false)
  assert.equal(compactSummaryHasContent('Summary:   \n\t '), false)
})

test('whitespace-only formatted summary has no content', () => {
  assert.equal(compactSummaryHasContent('   \n\t'), false)
})

test('a single substantive character after the header counts as content', () => {
  assert.equal(compactSummaryHasContent('Summary:\nx'), true)
})

test('content that does not start with the header still counts', () => {
  // The model wrote text outside the tags; the header strip only no-ops here.
  assert.equal(compactSummaryHasContent('Some preamble\n\nSummary:\nbody'), true)
})

test('only a leading "Summary:" is stripped, not one mid-text', () => {
  // A body that merely mentions "Summary:" later is real content.
  assert.equal(compactSummaryHasContent('real\nSummary: of work'), true)
})
