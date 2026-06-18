import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  mapWorkspaceSymbolsToLines,
  mapDocumentSymbolsToLines,
  flattenDocumentSymbols,
} from '../src/utils/codegraph/lspSymbols.mjs'

const cwd = '/work/proj'
const wsSym = (name, file, line, kind, containerName) => ({
  name,
  kind,
  containerName,
  location: { uri: `file://${file}`, range: { start: { line, character: 0 } } },
})

// --- workspace/symbol → find_definition lines --------------------------------

test('mapWorkspaceSymbolsToLines: relative path, 1-based line, kind name, container, sorted', () => {
  const { lines, count } = mapWorkspaceSymbolsToLines(
    [
      wsSym('beta', '/work/proj/src/b.ts', 4, 6, 'Widget'), // method, line 4 (0-based) → 5
      wsSym('alpha', '/work/proj/src/a.ts', 0, 12), // function, line 0 → 1
    ],
    cwd,
  )
  assert.equal(count, 2)
  // sorted by file: a.ts before b.ts
  assert.deepEqual(lines, [
    'src/a.ts:1\talpha\t(LSP function)',
    'src/b.ts:5\tbeta\t(LSP method in Widget)',
  ])
})

test('mapWorkspaceSymbolsToLines: nameFilter keeps only exact (case-insensitive) matches', () => {
  const syms = [
    wsSym('foo', '/work/proj/a.ts', 0, 12),
    wsSym('fooBar', '/work/proj/b.ts', 0, 12),
    wsSym('FOO', '/work/proj/c.ts', 0, 12),
  ]
  const { lines } = mapWorkspaceSymbolsToLines(syms, cwd, { nameFilter: 'foo' })
  assert.equal(lines.length, 2, 'foo and FOO match; fooBar does not')
  assert.ok(lines.every(l => /\bfoo\b|\bFOO\b/.test(l)))
  assert.ok(!lines.some(l => l.includes('fooBar')))
})

test('mapWorkspaceSymbolsToLines: dedups identical file:line:name, tolerates bad entries', () => {
  const s = wsSym('x', '/work/proj/a.ts', 0, 12)
  const { lines } = mapWorkspaceSymbolsToLines([s, { ...s }, null, { kind: 12 }, 'nope'], cwd)
  assert.deepEqual(lines, ['a.ts:1\tx\t(LSP function)'])
})

test('mapWorkspaceSymbolsToLines: non-array and unknown kind', () => {
  assert.deepEqual(mapWorkspaceSymbolsToLines(undefined, cwd), { lines: [], count: 0 })
  const { lines } = mapWorkspaceSymbolsToLines([wsSym('q', '/work/proj/a.ts', 0, 999)], cwd)
  assert.equal(lines[0], 'a.ts:1\tq\t(LSP symbol)') // unknown kind → "symbol"
})

// --- textDocument/documentSymbol → list_symbols lines ------------------------

test('flattenDocumentSymbols: nests children under the parent name as scope', () => {
  const docSyms = [
    { name: 'Widget', kind: 5, range: { start: { line: 0 } }, children: [
      { name: 'render', kind: 6, range: { start: { line: 2 } } },
      { name: 'mount', kind: 6, range: { start: { line: 5 } } },
    ] },
    { name: 'helper', kind: 12, range: { start: { line: 10 } } },
  ]
  assert.deepEqual(flattenDocumentSymbols(docSyms), [
    { name: 'Widget', kind: 'class', line: 1, scope: '' },
    { name: 'render', kind: 'method', line: 3, scope: 'Widget' },
    { name: 'mount', kind: 'method', line: 6, scope: 'Widget' },
    { name: 'helper', kind: 'function', line: 11, scope: '' },
  ])
})

test('mapDocumentSymbolsToLines: source order with scope annotation', () => {
  const docSyms = [
    { name: 'Svc', kind: 5, range: { start: { line: 0 } }, children: [
      { name: 'run', kind: 6, range: { start: { line: 1 } } },
    ] },
  ]
  assert.deepEqual(mapDocumentSymbolsToLines(docSyms).lines, [
    '1\tclass\tSvc',
    '2\tmethod\trun  (in Svc)',
  ])
})

test('mapDocumentSymbolsToLines: flat SymbolInformation[] (no children) works too', () => {
  const flat = [
    { name: 'a', kind: 12, location: { uri: 'file:///x.ts', range: { start: { line: 0 } } } },
    { name: 'b', kind: 13, location: { uri: 'file:///x.ts', range: { start: { line: 1 } } } },
  ]
  assert.deepEqual(mapDocumentSymbolsToLines(flat).lines, ['1\tfunction\ta', '2\tvariable\tb'])
})

test('flattenDocumentSymbols: legacy flat form keeps containerName as scope', () => {
  // SymbolInformation[] form nests via containerName (not children).
  const flat = [
    { name: 'Widget', kind: 5, location: { uri: 'file:///x.ts', range: { start: { line: 0 } } } },
    { name: 'render', kind: 6, containerName: 'Widget', location: { uri: 'file:///x.ts', range: { start: { line: 2 } } } },
  ]
  assert.deepEqual(mapDocumentSymbolsToLines(flat).lines, ['1\tclass\tWidget', '3\tmethod\trender  (in Widget)'])
})

test('mapWorkspaceSymbolsToLines: a non-file URI is returned verbatim, not relativized', () => {
  const sym = { name: 'x', kind: 13, location: { uri: 'untitled:Untitled-1', range: { start: { line: 0 } } } }
  const { lines } = mapWorkspaceSymbolsToLines([sym], cwd)
  assert.equal(lines[0], 'untitled:Untitled-1:1\tx\t(LSP variable)', 'raw URI, no ../ garble')
})
