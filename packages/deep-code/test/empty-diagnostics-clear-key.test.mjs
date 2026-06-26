import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyDiagnosticsClearKey } from '../src/services/lsp/emptyDiagnosticsClearKey.mjs'
import { dedupeDiagnosticFiles } from '../src/services/lsp/dedupeDiagnosticFiles.mjs'

test('an empty-diagnostics publish returns the file uri (the dedup-cache key to clear)', () => {
  assert.equal(
    emptyDiagnosticsClearKey([{ uri: '/abs/path/file.ts', diagnostics: [] }]),
    '/abs/path/file.ts',
  )
})

test('a publish carrying diagnostics returns null (nothing to clear)', () => {
  assert.equal(
    emptyDiagnosticsClearKey([
      { uri: '/abs/path/file.ts', diagnostics: [{ message: 'unused', severity: 1 }] },
    ]),
    null,
  )
})

test('no files returns null', () => {
  assert.equal(emptyDiagnosticsClearKey([]), null)
  assert.equal(emptyDiagnosticsClearKey(undefined), null)
  assert.equal(emptyDiagnosticsClearKey(null), null)
})

test('keys off the first file (formatDiagnosticsForAttachment emits exactly one)', () => {
  assert.equal(
    emptyDiagnosticsClearKey([
      { uri: '/first.ts', diagnostics: [] },
      { uri: '/second.ts', diagnostics: [] },
    ]),
    '/first.ts',
  )
})

test('the key is firstFile.uri verbatim (matches DiagnosticFile.uri / the dedup map key)', () => {
  // The clear key and the stored key both come from formatDiagnosticsForAttachment,
  // so the leaf must pass uri through unchanged or the clear would no-op.
  const key = emptyDiagnosticsClearKey([
    { uri: '/Users/x/proj/src/a.ts', diagnostics: [] },
  ])
  assert.equal(key, '/Users/x/proj/src/a.ts')
})

// Contract test against the real dedup: clearing the file's delivered-set (which
// is exactly what clearDeliveredDiagnosticsForFile does with the leaf's key) makes
// a re-occurring diagnostic deliverable again. This is the end-to-end behavior the
// fix relies on — an empty publish clears the cache so a recurrence is re-surfaced.
test('clearing the delivered-set for the file re-enables delivery of a recurring diagnostic', () => {
  const uri = '/Users/x/proj/src/a.ts'
  const createKey = d => `${d.range.start.line}:${d.message}`
  const diagA = { message: 'unused var', severity: 1, range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } } }

  // The cross-turn delivered cache, modeling LSPDiagnosticRegistry.deliveredDiagnostics.
  const delivered = new Map([[uri, new Set([createKey(diagA)])]])
  const getPreviouslyDelivered = u => delivered.get(u) || new Set()

  // 1) With diagA already delivered, a re-publish of diagA is suppressed.
  const beforeClear = dedupeDiagnosticFiles(
    [{ uri, diagnostics: [diagA] }],
    { getPreviouslyDelivered, createKey },
  )
  assert.deepEqual(beforeClear, [], 'recurring diagnostic suppressed while still cached')

  // 2) An empty publish: the leaf yields the key to clear; clearing drops the set.
  const clearKey = emptyDiagnosticsClearKey([{ uri, diagnostics: [] }])
  assert.equal(clearKey, uri)
  delivered.delete(clearKey)

  // 3) The same diagnostic re-publishes — now it IS delivered (the bug was that
  //    without the clear it would still be suppressed at step 1's state).
  const afterClear = dedupeDiagnosticFiles(
    [{ uri, diagnostics: [diagA] }],
    { getPreviouslyDelivered, createKey },
  )
  assert.equal(afterClear.length, 1, 'recurring diagnostic re-delivered after clear')
  assert.deepEqual(afterClear[0].diagnostics, [diagA])
})
