import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCodegraphQuery } from '../src/utils/codegraph/workspace.mjs'

// runCodegraphQuery prefers an injected LSP resolver for list_symbols /
// find_definition, falling back to the regex heuristic when the resolver returns
// null. These inject a fake resolver to pin the routing without a real LSP server.

const NOOP_SIGNAL = { aborted: false }

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'codegraph-lsp-'))
  writeFileSync(join(ws, 'a.ts'), 'export function alpha() { return 1 }\n')
  return ws
}

test('find_definition: LSP hits rank first BUT heuristic other-language hits are MERGED (no recall loss)', async () => {
  // The recall-safety invariant: LSP coverage can be partial. `alpha` exists in
  // a.ts (heuristic) and the LSP reports it at a DIFFERENT location (a covered
  // language). Both must survive — LSP first, the heuristic hit appended.
  const ws = makeWorkspace()
  try {
    const res = await runCodegraphQuery({
      input: { query: 'find_definition', name: 'alpha' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts'],
      lspResolve: {
        findDefinition: async name => ({
          lines: [`pkg/native.go:9\t${name}\t(LSP function)`],
          note: 'Resolved via LSP (authoritative).',
        }),
      },
    })
    assert.equal(res.lines[0], 'pkg/native.go:9\talpha\t(LSP function)', 'LSP hit ranks first')
    assert.ok(
      res.lines.some(l => l.includes('a.ts') && l.includes('alpha')),
      'the heuristic hit in an LSP-uncovered file is NOT dropped',
    )
    assert.equal(res.count, res.lines.length)
    assert.match(res.note, /LSP.*authoritative.*additional heuristic/s)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('find_definition: a heuristic hit at the SAME file:line:name as an LSP hit is deduped', async () => {
  const ws = makeWorkspace() // a.ts defines alpha at line 1
  try {
    const res = await runCodegraphQuery({
      input: { query: 'find_definition', name: 'alpha' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts'],
      lspResolve: {
        findDefinition: async name => ({
          lines: [`a.ts:1\t${name}\t(LSP function)`], // same declaration the heuristic finds
          note: 'Resolved via LSP (authoritative).',
        }),
      },
    })
    assert.deepEqual(res.lines, ['a.ts:1\talpha\t(LSP function)'], 'one entry, the authoritative LSP one')
    assert.equal(res.note, 'Resolved via LSP (authoritative).')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('find_definition: a null LSP result falls back to the heuristic index', async () => {
  const ws = makeWorkspace()
  try {
    let listCalled = false
    const res = await runCodegraphQuery({
      input: { query: 'find_definition', name: 'alpha' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => {
        listCalled = true
        return ['a.ts']
      },
      lspResolve: { findDefinition: async () => null },
    })
    assert.equal(listCalled, true, 'fell back to the heuristic (index was built)')
    assert.ok(res.lines.some(l => l.includes('a.ts') && l.includes('alpha')))
    assert.match(res.note, /[Hh]euristic/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('list_symbols: a non-null LSP result wins (no single-file heuristic index)', async () => {
  const res = await runCodegraphQuery({
    input: { query: 'list_symbols', file: 'a.ts' },
    cwd: '/anywhere',
    signal: NOOP_SIGNAL,
    listFiles: async () => [],
    lspResolve: {
      listSymbols: async () => ({ lines: ['1\tfunction\talpha'], note: 'Resolved via LSP (authoritative).' }),
    },
  })
  assert.deepEqual(res.lines, ['1\tfunction\talpha'])
  assert.match(res.note, /LSP/)
})

test('list_symbols: a null LSP result falls back to the heuristic single-file index', async () => {
  const ws = makeWorkspace()
  try {
    const res = await runCodegraphQuery({
      input: { query: 'list_symbols', file: 'a.ts' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts'],
      lspResolve: { listSymbols: async () => null },
    })
    assert.ok(res.lines.some(l => l.includes('alpha')), 'heuristic listed the symbol')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('no lspResolve: behavior is the pure heuristic (unchanged offline path)', async () => {
  const ws = makeWorkspace()
  try {
    const res = await runCodegraphQuery({
      input: { query: 'list_symbols', file: 'a.ts' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts'],
    })
    assert.ok(res.lines.some(l => l.includes('alpha')))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('find_definition: other query kinds (importers) never consult the LSP resolver', async () => {
  const ws = makeWorkspace()
  try {
    let lspCalled = false
    const res = await runCodegraphQuery({
      input: { query: 'importers', module: './b.ts' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts'],
      lspResolve: {
        findDefinition: async () => {
          lspCalled = true
          return { lines: ['x'], note: 'lsp' }
        },
        listSymbols: async () => {
          lspCalled = true
          return { lines: ['x'], note: 'lsp' }
        },
      },
    })
    assert.equal(lspCalled, false, 'importers is heuristic-only')
    assert.equal(res.query, 'importers')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
