import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFileReadSymbolDigest,
  isClearedToolResultContent,
  CLEARED_PREFIX,
} from '../src/services/compact/clearedToolDigest.mjs'

// The plain microcompact sentinel (defined in microCompact.ts / toolResultStorage).
// Hard-coded here because it lives in a .ts module; this asserts the recognizer's
// prefix stays a prefix of it (drift guard).
const PLAIN_SENTINEL = '[Old tool result content cleared]'

test('CLEARED_PREFIX is a prefix of the plain sentinel (idempotency recognizer holds)', () => {
  assert.ok(PLAIN_SENTINEL.startsWith(CLEARED_PREFIX))
})

test('isClearedToolResultContent recognizes the sentinel and digests, rejects real content', () => {
  assert.equal(isClearedToolResultContent(PLAIN_SENTINEL), true)
  assert.equal(
    isClearedToolResultContent('[Old tool result content cleared - a.ts defines: foo]'),
    true,
  )
  assert.equal(
    isClearedToolResultContent('[Old tool result content cleared - a.ts (partial read) defines: foo]'),
    true,
  )
  assert.equal(isClearedToolResultContent('export function foo() {}'), false)
  assert.equal(isClearedToolResultContent(''), false)
  // A real result that merely BEGINS with the phrase but isn't one of the two
  // exact cleared shapes must NOT be mistaken for already-cleared (else it leaks
  // uncleared). The recognizer requires the prefix be followed by ']' or ' - '.
  assert.equal(isClearedToolResultContent('[Old tool result content cleared yesterday by a human'), false)
  // non-string content (e.g. an image/document block array) is never "cleared"
  assert.equal(isClearedToolResultContent([{ type: 'text', text: 'x' }]), false)
  assert.equal(isClearedToolResultContent(undefined), false)
})

test('buildFileReadSymbolDigest labels a partial (offset/limit) read as a window', () => {
  const src = 'export function alpha() {}\nexport function beta() {}'
  const full = buildFileReadSymbolDigest('/x/m.ts', src)
  const partial = buildFileReadSymbolDigest('/x/m.ts', src, { partial: true })
  assert.ok(!full.includes('partial read'), 'a full read is not labelled')
  assert.ok(partial.includes('(partial read)'), 'a partial read is labelled a window')
  assert.ok(isClearedToolResultContent(partial), 'the partial digest is still a recognized cleared shape')
})

test('buildFileReadSymbolDigest lists distinct declared symbols, starts with the prefix', () => {
  const src = [
    'export function alpha() {}',
    'function beta() {}',
    'export class Widget {}',
    'export const gamma = 1',
  ].join('\n')
  const digest = buildFileReadSymbolDigest('/abs/path/to/mod.ts', src)
  assert.ok(digest.startsWith(CLEARED_PREFIX), 'digest is recognized as cleared')
  assert.ok(digest.includes('mod.ts'), 'uses the basename, not the full path')
  for (const name of ['alpha', 'beta', 'Widget', 'gamma']) {
    assert.ok(digest.includes(name), `lists ${name}`)
  }
  assert.ok(digest.endsWith(']'))
})

test('buildFileReadSymbolDigest bounds to maxSymbols with a (+N more) suffix', () => {
  const src = Array.from({ length: 20 }, (_, i) => `export function f${i}() {}`).join('\n')
  const digest = buildFileReadSymbolDigest('/x/big.ts', src, { maxSymbols: 5 })
  assert.match(digest, /\(\+15 more\)\]$/)
  assert.ok(digest.includes('f0') && digest.includes('f4'))
  assert.ok(!digest.includes('f5,') && !digest.includes('f19'), 'symbols past the cap are not listed')
})

test('buildFileReadSymbolDigest de-duplicates repeated names', () => {
  const src = [
    'export function dup() {}',
    'class C { dup() {} }', // a method also named dup
  ].join('\n')
  const digest = buildFileReadSymbolDigest('/x/m.ts', src)
  const occurrences = digest.split('dup').length - 1
  assert.equal(occurrences, 1, 'the name dup appears once')
})

test('buildFileReadSymbolDigest returns null for unsupported language / no symbols / bad args', () => {
  assert.equal(buildFileReadSymbolDigest('/x/readme.txt', 'export function f() {}'), null, 'unsupported ext')
  assert.equal(buildFileReadSymbolDigest('/x/notes.md', '# heading\nsome prose'), null)
  assert.equal(buildFileReadSymbolDigest('/x/empty.ts', ''), null, 'empty source')
  assert.equal(buildFileReadSymbolDigest('/x/comment.ts', '// just a comment\n/* block */'), null, 'no declarations')
  assert.equal(buildFileReadSymbolDigest(null, 'export function f() {}'), null)
  assert.equal(buildFileReadSymbolDigest('/x/m.ts', null), null)
})

test('buildFileReadSymbolDigest works across languages (python, go)', () => {
  const py = buildFileReadSymbolDigest('/x/m.py', 'def handler():\n    pass\nclass Service:\n    pass\n')
  assert.ok(py.includes('handler') && py.includes('Service'))
  const go = buildFileReadSymbolDigest('/x/m.go', 'package main\nfunc Run() {}\ntype Server struct {}\n')
  assert.ok(go.includes('Run') && go.includes('Server'))
})

test('end-to-end: a cat -n FileRead body, line-number-stripped, digests correctly', () => {
  // Mirror addLineNumbers (the `N→` / right-padded form) and the freshness/reminder
  // noise lines FileRead prepends — none of which should yield false symbols.
  const body = [
    '<system-reminder>file is fresh</system-reminder>',
    '     1→export function alpha() {}',
    '     2→export class Widget {}',
    '     3→// trailing note',
  ].join('\n')
  // Same strip as the SSOT stripLineNumberPrefix (utils/file.ts): `^\s*\d+[→\t](.*)$`
  const raw = body
    .split('\n')
    .map(line => line.match(/^\s*\d+[→\t](.*)$/)?.[1] ?? line)
    .join('\n')
  const digest = buildFileReadSymbolDigest('/x/mod.ts', raw)
  assert.ok(digest.includes('alpha') && digest.includes('Widget'))
  assert.ok(!digest.includes('system-reminder'), 'noise prefix is not a symbol')
})
