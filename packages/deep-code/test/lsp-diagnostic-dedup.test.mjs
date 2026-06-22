import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dedupeDiagnosticFiles } from '../src/services/lsp/dedupeDiagnosticFiles.mjs'

// Content key over the deduped fields (mirrors createDiagnosticKey).
const createKey = d =>
  JSON.stringify({
    message: d.message,
    severity: d.severity,
    range: d.range,
    source: d.source ?? null,
    code: d.code ?? null,
  })

const noPrev = () => new Set()

function diag(message, line = 0) {
  return { message, severity: 'error', range: { line }, source: 'tsc', code: null }
}

// Verbatim O(M*N) reference: the old array + dedupedFiles.find() implementation.
function dedupeOld(allFiles, getPreviouslyDelivered, createKeyFn) {
  const fileMap = new Map()
  const dedupedFiles = []
  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set())
      dedupedFiles.push({ uri: file.uri, diagnostics: [] })
    }
    const seen = fileMap.get(file.uri)
    const dedupedFile = dedupedFiles.find(f => f.uri === file.uri)
    const previouslyDelivered = getPreviouslyDelivered(file.uri)
    for (const d of file.diagnostics) {
      const key = createKeyFn(d)
      if (seen.has(key) || previouslyDelivered.has(key)) continue
      seen.add(key)
      dedupedFile.diagnostics.push(d)
    }
  }
  return dedupedFiles.filter(f => f.diagnostics.length > 0)
}

test('drops within-batch duplicates, keeps first occurrence, preserves uri order', () => {
  const allFiles = [
    { uri: 'b.ts', diagnostics: [diag('x'), diag('x')] }, // dup
    { uri: 'a.ts', diagnostics: [diag('y')] },
    { uri: 'b.ts', diagnostics: [diag('x'), diag('z')] }, // x dup, z new
  ]
  const out = dedupeDiagnosticFiles(allFiles, {
    getPreviouslyDelivered: noPrev,
    createKey,
  })
  // first-seen uri order: b.ts then a.ts
  assert.deepEqual(out.map(f => f.uri), ['b.ts', 'a.ts'])
  assert.deepEqual(out[0].diagnostics.map(d => d.message), ['x', 'z'])
  assert.deepEqual(out[1].diagnostics.map(d => d.message), ['y'])
})

test('cross-turn previously-delivered keys are skipped per uri', () => {
  const delivered = new Set([createKey(diag('old'))])
  const out = dedupeDiagnosticFiles(
    [{ uri: 'a.ts', diagnostics: [diag('old'), diag('new')] }],
    { getPreviouslyDelivered: uri => (uri === 'a.ts' ? delivered : new Set()), createKey },
  )
  assert.deepEqual(out, [{ uri: 'a.ts', diagnostics: [diag('new')] }])
})

test('files with no surviving diagnostics are filtered out', () => {
  const delivered = new Set([createKey(diag('gone'))])
  const out = dedupeDiagnosticFiles(
    [{ uri: 'a.ts', diagnostics: [diag('gone')] }],
    { getPreviouslyDelivered: () => delivered, createKey },
  )
  assert.deepEqual(out, [])
})

test('a createKey throw is reported and the diagnostic is kept anyway', () => {
  const errors = []
  const out = dedupeDiagnosticFiles(
    [{ uri: 'a.ts', diagnostics: [diag('boom'), diag('ok')] }],
    {
      getPreviouslyDelivered: noPrev,
      createKey: d => {
        if (d.message === 'boom') throw new Error('bad key')
        return createKey(d)
      },
      onKeyError: (uri, d, error) => errors.push([uri, d.message, String(error)]),
    },
  )
  assert.equal(errors.length, 1)
  assert.deepEqual(errors[0].slice(0, 2), ['a.ts', 'boom'])
  // boom kept (key failed) + ok kept
  assert.deepEqual(out[0].diagnostics.map(d => d.message), ['boom', 'ok'])
})

test('does not mutate the input files', () => {
  const allFiles = [{ uri: 'a.ts', diagnostics: [diag('x'), diag('x')] }]
  const before = JSON.stringify(allFiles)
  dedupeDiagnosticFiles(allFiles, { getPreviouslyDelivered: noPrev, createKey })
  assert.equal(JSON.stringify(allFiles), before)
})

test('differential: matches the old O(M*N) array+find impl exactly (randomized)', () => {
  const uris = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
  const msgs = ['m0', 'm1', 'm2', 'm3', 'm4']
  let seed = 98765
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let trial = 0; trial < 300; trial++) {
    // many file entries sharing few uris (exercises the old per-file find scan)
    const fileCount = Math.floor(rand() * 30)
    const allFiles = []
    for (let f = 0; f < fileCount; f++) {
      const uri = uris[Math.floor(rand() * uris.length)]
      const dn = Math.floor(rand() * 4)
      const ds = []
      for (let k = 0; k < dn; k++) {
        ds.push(diag(msgs[Math.floor(rand() * msgs.length)], Math.floor(rand() * 3)))
      }
      allFiles.push({ uri, diagnostics: ds })
    }
    // random previously-delivered set keyed per uri
    const deliveredByUri = new Map()
    for (const u of uris) {
      const s = new Set()
      if (rand() < 0.4) s.add(createKey(diag(msgs[Math.floor(rand() * msgs.length)], 0)))
      deliveredByUri.set(u, s)
    }
    const getPrev = u => deliveredByUri.get(u) ?? new Set()
    assert.deepEqual(
      dedupeDiagnosticFiles(allFiles, { getPreviouslyDelivered: getPrev, createKey }),
      dedupeOld(allFiles, getPrev, createKey),
    )
  }
})
