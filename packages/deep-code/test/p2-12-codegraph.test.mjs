import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractJsTs,
  extractPython,
  maskJsTs,
  maskPython,
  languageForPath,
  extractFile,
} from '../src/utils/codegraph/languages.mjs'
import { buildIndex } from '../src/utils/codegraph/indexer.mjs'
import {
  listSymbols,
  findDefinition,
  importGraph,
  importersOf,
  importsOf,
} from '../src/utils/codegraph/query.mjs'

const names = syms => syms.map(s => s.name)
const find = (syms, name) => syms.find(s => s.name === name)

// --- masking -------------------------------------------------------------

test('maskJsTs blanks comment/string bodies, preserving newlines and length', () => {
  const src = `const a = "function notReal() {}"\n// function alsoNotReal() {}\n/* class Hidden {} */\nfunction real() {}`
  const masked = maskJsTs(src)
  assert.equal(masked.length, src.length, 'length preserved')
  assert.equal(masked.split('\n').length, src.split('\n').length, 'line count preserved')
  assert.doesNotMatch(masked, /notReal|alsoNotReal|Hidden/, 'code inside strings/comments is blanked')
  assert.match(masked, /function real\(\)/, 'real code survives')
})

test('extractJsTs ignores declarations inside strings and comments', () => {
  const { symbols } = extractJsTs(
    `// export function fake() {}\nlog("class FakeClass {}")\nexport function realOne() {}`,
  )
  assert.deepEqual(names(symbols), ['realOne'])
  assert.equal(find(symbols, 'realOne').exported, true)
})

// --- JS/TS extraction -----------------------------------------------------

test('extractJsTs captures functions, classes, vars, TS types with kind/line/exported', () => {
  const src = [
    `export function foo() {}`,            // 1
    `function bar() {}`,                   // 2
    `export const baz = 1`,                // 3
    `let qux = 2`,                         // 4
    `export class Widget {}`,              // 5
    `interface Shape { x: number }`,       // 6
    `export type ID = string`,             // 7
    `enum Color { Red }`,                  // 8
    `export default class App {}`,         // 9
  ].join('\n')
  const { symbols } = extractJsTs(src)

  assert.deepEqual(find(symbols, 'foo'), { name: 'foo', kind: 'function', line: 1, exported: true, scope: '' })
  assert.equal(find(symbols, 'bar').exported, false)
  assert.equal(find(symbols, 'baz').kind, 'const')
  assert.equal(find(symbols, 'qux').kind, 'let')
  assert.equal(find(symbols, 'Widget').kind, 'class')
  assert.equal(find(symbols, 'Shape').kind, 'interface')
  assert.equal(find(symbols, 'ID').kind, 'type')
  assert.equal(find(symbols, 'Color').kind, 'enum')
  assert.equal(find(symbols, 'App').exported, true)
  assert.equal(find(symbols, 'App').line, 9)
})

test('extractJsTs attributes methods to their enclosing class scope', () => {
  const src = [
    `export class Service {`,   // 1
    `  start() {}`,             // 2
    `  async stop() {}`,        // 3
    `  private helper() {}`,    // 4
    `}`,                        // 5
    `function loose() {}`,      // 6
  ].join('\n')
  const { symbols } = extractJsTs(src)
  const start = find(symbols, 'start')
  assert.equal(start.kind, 'method')
  assert.equal(start.scope, 'Service')
  assert.equal(find(symbols, 'stop').scope, 'Service')
  assert.equal(find(symbols, 'helper').scope, 'Service')
  // A top-level function after the class closes is back at top-level scope.
  assert.equal(find(symbols, 'loose').scope, '')
  // Control-flow keywords are never captured as methods.
  assert.equal(symbols.some(s => ['if', 'for', 'while', 'catch'].includes(s.name)), false)
})

test('extractJsTs does not mistake calls/keywords for methods', () => {
  const src = [
    `class C {`,
    `  if (x) {}`,        // not a method (keyword)
    `  doThing() {}`,     // method
    `}`,
  ].join('\n')
  const { symbols } = extractJsTs(src)
  assert.deepEqual(names(symbols).filter(n => n !== 'C'), ['doThing'])
})

test('extractJsTs collects import / require / dynamic-import / export-from', () => {
  const src = [
    `import { a } from './a.js'`,
    `import b from "pkg"`,
    `const c = require('./c.js')`,
    `export { d } from './d.js'`,
    `const e = await import('./e.js')`,
  ].join('\n')
  const { imports } = extractJsTs(src)
  const byKind = Object.fromEntries(imports.map(i => [i.module, i.kind]))
  assert.equal(byKind['./a.js'], 'import')
  assert.equal(byKind['pkg'], 'import')
  assert.equal(byKind['./c.js'], 'require')
  assert.equal(byKind['./d.js'], 'export-from')
  assert.equal(byKind['./e.js'], 'dynamic-import')
})

test('require/import calls preceded by a dot are not treated as imports', () => {
  const { imports } = extractJsTs(`foo.require('./not-an-import.js')`)
  assert.equal(imports.length, 0)
})

// --- regressions from adversarial probing ---------------------------------

test('regression: const enum captures the enum name, not the keyword', () => {
  const { symbols } = extractJsTs(`export const enum Color { Red, Green }\nconst enum Dir { Up }`)
  assert.equal(find(symbols, 'Color').kind, 'enum')
  assert.equal(find(symbols, 'Color').exported, true)
  assert.equal(find(symbols, 'Dir').kind, 'enum')
  assert.equal(find(symbols, 'Dir').exported, false)
  assert.equal(symbols.some(s => s.name === 'enum'), false, 'never captures the keyword as a name')
})

test('regression: abstract classes and their methods are captured', () => {
  const src = [
    `export abstract class Repository {`,  // 1
    `  abstract findOne(id: string): void`,// 2
    `  save(x: object) {}`,                // 3
    `}`,                                   // 4
  ].join('\n')
  const { symbols } = extractJsTs(src)
  assert.equal(find(symbols, 'Repository').kind, 'class')
  assert.equal(find(symbols, 'Repository').exported, true)
  assert.equal(find(symbols, 'findOne').scope, 'Repository')
  assert.equal(find(symbols, 'save').scope, 'Repository')
})

test('regression: multi-line named imports are captured', () => {
  const src = [`import {`, `  useState,`, `  useEffect,`, `} from 'react'`].join('\n')
  const { imports } = extractJsTs(src)
  assert.deepEqual(imports.map(i => i.module), ['react'])
  assert.equal(imports[0].kind, 'import')
  assert.equal(imports[0].line, 1, 'attributed to the opening import line')
})

test('regression: a line-leading dynamic import is not double-counted', () => {
  const { imports } = extractJsTs(`import('./lazy.js').then(m => m.run())`)
  assert.deepEqual(imports, [{ module: './lazy.js', line: 1, kind: 'dynamic-import' }])
})

test('regression: class-field arrow functions are captured as methods', () => {
  const src = [`class C {`, `  handler = () => {}`, `  onClick = async (e) => {}`, `}`].join('\n')
  const { symbols } = extractJsTs(src)
  assert.equal(find(symbols, 'handler')?.kind, 'method')
  assert.equal(find(symbols, 'handler')?.scope, 'C')
  assert.equal(find(symbols, 'onClick')?.scope, 'C')
})

test('regression: Python multi-target import records every module', () => {
  const { imports } = extractPython(`import os, sys, json\nimport a.b as c, d`)
  assert.deepEqual(
    imports.map(i => i.module).sort(),
    ['a.b', 'd', 'json', 'os', 'sys'],
  )
})

test('regression: a regex literal with a stray brace does not corrupt scope', () => {
  // The `}` inside /[}]/ must be masked, or brace-depth tracking pops the class
  // scope early and drops `m`.
  const { symbols } = extractJsTs([`class C {`, `  pattern = /[}]/`, `  m() {}`, `}`].join('\n'))
  assert.equal(find(symbols, 'm')?.kind, 'method')
  assert.equal(find(symbols, 'm')?.scope, 'C')
  // And a division `/` is still treated as code (not a regex swallowing the line).
  const { symbols: s2 } = extractJsTs([`class D {`, `  total = a / b / c`, `  go() {}`, `}`].join('\n'))
  assert.equal(find(s2, 'go')?.scope, 'D')
})

test('regression: override-modified class methods are captured', () => {
  // `override`/`static override`/`async` methods must not be dropped. Plain
  // value fields (count = 0) are intentionally not indexed (only methods +
  // field-arrows), so we assert the method, not the field.
  const src = [`class C {`, `  override render() {}`, `  static override init() {}`, `}`].join('\n')
  const { symbols } = extractJsTs(src)
  assert.equal(find(symbols, 'render')?.scope, 'C')
  assert.equal(find(symbols, 'init')?.scope, 'C')
})

test('regression: importersOf requires matching extension when the needle has one', async () => {
  const fixtures = {
    'a.ts': `import { x } from './foo.ts'`,
    'b.ts': `import { y } from './foo.js'`,
    'c.ts': `import { z } from './foo'`,
  }
  const index = await buildIndex({ files: Object.keys(fixtures), readFile: p => fixtures[p] })
  // Needle with an extension matches only that extension (a.ts), not foo.js/foo.
  assert.deepEqual(importersOf(index, 'foo.ts').map(r => r.file), ['a.ts'])
  // Extensionless needle matches all foo variants.
  assert.deepEqual(importersOf(index, 'foo').map(r => r.file).sort(), ['a.ts', 'b.ts', 'c.ts'])
})

// --- Python extraction ----------------------------------------------------

test('extractPython captures def/class with indentation-based scope', () => {
  const src = [
    `import os`,                 // 1
    `from .pkg import thing`,    // 2
    `def top():`,                // 3
    `    def inner():`,          // 4
    `        pass`,              // 5
    `class Animal:`,             // 6
    `    def speak(self):`,      // 7
    `        pass`,              // 8
  ].join('\n')
  const { symbols, imports } = extractPython(src)

  assert.equal(find(symbols, 'top').scope, '')
  assert.equal(find(symbols, 'top').exported, true)
  assert.equal(find(symbols, 'inner').scope, 'top')
  assert.equal(find(symbols, 'inner').exported, false)
  assert.equal(find(symbols, 'Animal').kind, 'class')
  assert.equal(find(symbols, 'speak').scope, 'Animal')
  assert.equal(find(symbols, 'speak').kind, 'def')

  assert.deepEqual(imports.map(i => i.module).sort(), ['.pkg', 'os'])
})

test('maskPython blanks triple-quoted docstrings so decls inside are ignored', () => {
  const src = [
    `def real():`,
    `    """`,
    `    def fake_in_docstring():`,
    `        pass`,
    `    """`,
    `    return 1`,
  ].join('\n')
  const masked = maskPython(src)
  assert.equal(masked.length, src.length)
  const { symbols } = extractPython(src)
  assert.deepEqual(names(symbols), ['real'])
})

// --- dispatch -------------------------------------------------------------

test('languageForPath / extractFile dispatch by extension', () => {
  assert.equal(languageForPath('a/b.tsx'), 'jsts')
  assert.equal(languageForPath('a/b.mjs'), 'jsts')
  assert.equal(languageForPath('a/b.py'), 'python')
  assert.equal(languageForPath('a/b.go'), null)
  assert.equal(extractFile('x.txt', 'whatever'), null)
  assert.ok(extractFile('x.ts', 'export const z = 1').symbols.length === 1)
})

// --- indexer --------------------------------------------------------------

function memReadFile(fixtures) {
  return path => {
    if (!(path in fixtures)) throw new Error(`ENOENT ${path}`)
    return fixtures[path]
  }
}

test('buildIndex indexes supported files and skips the rest', async () => {
  const fixtures = {
    'src/a.ts': `export function alpha() {}\nexport const shared = 1`,
    'src/b.py': `def beta():\n    pass`,
    'README.md': `# not code`,        // unsupported -> skipped
    'src/missing.ts': undefined,       // unreadable handled by absence
  }
  const index = await buildIndex({
    files: ['src/a.ts', 'src/b.py', 'README.md', 'does-not-exist.ts'],
    readFile: memReadFile(fixtures),
  })
  assert.equal(index.fileCount, 2)
  assert.ok(index.skipped >= 2)
  assert.deepEqual(names(index.byFile['src/a.ts'].symbols).sort(), ['alpha', 'shared'])
  assert.ok('alpha' in index.byName)
  assert.equal(index.byName['alpha'][0].file, 'src/a.ts')
})

test('regression: symbols named like Object.prototype members do not crash the index', async () => {
  // `constructor`, `toString`, `__proto__`, `hasOwnProperty` collide with
  // Object.prototype on a plain-object map — the index must use a null proto.
  const src = [
    `export class C {`,
    `  constructor() {}`,
    `  toString() {}`,
    `  hasOwnProperty() {}`,
    `}`,
    `function __proto__() {}`,
  ].join('\n')
  const index = await buildIndex({ files: ['c.ts'], readFile: () => src })
  assert.ok(Array.isArray(index.byName['constructor']))
  assert.equal(findDefinition(index, 'constructor')[0].file, 'c.ts')
  assert.equal(findDefinition(index, '__proto__')[0].kind, 'function')
  assert.equal(findDefinition(index, 'toString').length, 1)
})

test('buildIndex skips files exceeding maxFileBytes', async () => {
  const big = 'export const x = 1\n'.repeat(1000)
  const index = await buildIndex({
    files: ['big.ts'],
    readFile: () => big,
    maxFileBytes: 100,
  })
  assert.equal(index.fileCount, 0)
})

test('buildIndex validates its arguments', async () => {
  await assert.rejects(() => buildIndex({ files: 'nope', readFile: () => '' }), /files array/)
  await assert.rejects(() => buildIndex({ files: [], readFile: null }), /readFile function/)
})

// --- queries --------------------------------------------------------------

async function fixtureIndex() {
  const fixtures = {
    'src/widget.ts': [
      `import { helper } from './util.js'`,
      `export function render() {}`,
      `class Widget {`,
      `  render() {}`,
      `}`,
    ].join('\n'),
    'src/util.ts': `export function helper() {}\nconst render = () => {}`,
    'src/app.ts': `import { render } from './widget.js'\nimport { helper } from './util.js'`,
  }
  return buildIndex({ files: Object.keys(fixtures), readFile: memReadFile(fixtures) })
}

test('listSymbols / importsOf return per-file data', async () => {
  const index = await fixtureIndex()
  assert.deepEqual(names(listSymbols(index, 'src/util.ts')).sort(), ['helper', 'render'])
  assert.deepEqual(importsOf(index, 'src/widget.ts').map(i => i.module), ['./util.js'])
  assert.deepEqual(listSymbols(index, 'no/such/file.ts'), [])
})

test('findDefinition ranks exported top-level declarations above methods/vars', async () => {
  const index = await fixtureIndex()
  const results = findDefinition(index, 'render')
  // exported function render (widget.ts) should outrank the arrow-const in
  // util.ts and the Widget.render method.
  assert.equal(results[0].file, 'src/widget.ts')
  assert.equal(results[0].kind, 'function')
  assert.equal(results[0].exported, true)
  assert.ok(results[0].confidence > results[results.length - 1].confidence)
  assert.ok(results[0].why.includes('exported'))
  // All three "render" declarations are surfaced as candidates.
  assert.equal(results.length, 3)
})

test('findDefinition is case-insensitive but prefers exact case', async () => {
  const index = await fixtureIndex()
  const results = findDefinition(index, 'RENDER')
  assert.ok(results.length >= 1, 'case-insensitive match found')
  // None is an exact-case match, so all carry the case-insensitive reason.
  assert.ok(results.every(r => r.why.includes('case-insensitive')))
  assert.deepEqual(findDefinition(index, ''), [])
  assert.deepEqual(findDefinition(index, 'doesNotExist'), [])
})

test('importGraph and importersOf trace dependencies', async () => {
  const index = await fixtureIndex()
  const graph = importGraph(index)
  assert.deepEqual(graph['src/app.ts'].sort(), ['./util.js', './widget.js'])

  // Who imports util? both widget and app (./util.js).
  const utilImporters = importersOf(index, 'util').map(r => r.file).sort()
  assert.deepEqual(utilImporters, ['src/app.ts', 'src/widget.ts'])

  // Single-file restriction.
  assert.deepEqual(Object.keys(importGraph(index, { file: 'src/app.ts' })), ['src/app.ts'])
})
