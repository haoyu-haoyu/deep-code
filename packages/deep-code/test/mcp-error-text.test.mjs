import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractMcpErrorText } from '../src/services/mcp/extractMcpErrorText.mjs'

test('common case: a single leading text block (byte-identical to the old path)', () => {
  assert.equal(
    extractMcpErrorText({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
    'boom',
  )
})

test('the fix: a non-text block leads, the message is in a later text block', () => {
  assert.equal(
    extractMcpErrorText({
      content: [
        { type: 'image', data: '...' },
        { type: 'text', text: 'Quota exceeded: retry after 60s' },
      ],
    }),
    'Quota exceeded: retry after 60s',
  )
  // resource-first + text
  assert.equal(
    extractMcpErrorText({
      content: [{ type: 'resource', resource: { uri: 'x' } }, { type: 'text', text: 'denied' }],
    }),
    'denied',
  )
})

test('multiple text blocks are joined (multi-part message preserved)', () => {
  assert.equal(
    extractMcpErrorText({ content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }),
    'line1\nline2',
  )
})

test('an embedded-resource text (block.resource.text) is NOT pulled in', () => {
  // Only top-level block.text counts; resource.text is nested.
  assert.equal(
    extractMcpErrorText({ content: [{ type: 'resource', resource: { text: 'nested' } }] }),
    'Unknown error',
  )
})

test('no text blocks at all → fallback', () => {
  assert.equal(extractMcpErrorText({ content: [{ type: 'image', data: 'x' }] }), 'Unknown error')
})

test('legacy `error` field is used only when there is no content array', () => {
  assert.equal(extractMcpErrorText({ error: 'legacy message' }), 'legacy message')
  assert.equal(extractMcpErrorText({ error: { code: -32000 } }), '[object Object]')
  // content present but empty → falls through to legacy error
  assert.equal(extractMcpErrorText({ content: [], error: 'legacy' }), 'legacy')
})

test('content present (non-text) does NOT fall back to a sibling `error` field', () => {
  // Mirrors the original: when content exists, the legacy `error` is not consulted.
  assert.equal(
    extractMcpErrorText({ content: [{ type: 'image' }], error: 'should-not-win' }),
    'Unknown error',
  )
})

test('a non-string top-level text is ignored', () => {
  assert.equal(extractMcpErrorText({ content: [{ type: 'text', text: 42 }] }), 'Unknown error')
})

test('empty / non-object input → fallback', () => {
  assert.equal(extractMcpErrorText(undefined), 'Unknown error')
  assert.equal(extractMcpErrorText(null), 'Unknown error')
  assert.equal(extractMcpErrorText({}), 'Unknown error')
})
