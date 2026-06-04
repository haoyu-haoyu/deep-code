import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MAX_FILES,
  resolveInsideCwd,
  readWorkspaceFile,
  indexWorkspace,
  indexSingleFile,
  runCodegraphQuery,
} from '../src/utils/codegraph/workspace.mjs'

// ── CodeGraph tool CORE (the .ts wrapper's extracted, DI'd logic) ───────────
// The pure index/query functions are covered by p2-12-codegraph.test.mjs; this
// file covers the WRAPPER logic that used to live untested in CodegraphTool.ts:
// path sandboxing, single-file vs workspace indexing, MAX_FILES truncation,
// lister-failure vs cancellation, and the query dispatch + notes.

const NOOP_SIGNAL = { aborted: false }

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'codegraph-tool-'))
  writeFileSync(join(ws, 'a.ts'), "import { beta } from './b.ts'\nexport function alpha() { return 1 }\n")
  writeFileSync(join(ws, 'b.ts'), 'export function beta() { return 2 }\n')
  // A legitimately-named file whose name starts with ".." — the resolveInsideCwd
  // fix must allow reading it (it lives INSIDE the workspace).
  writeFileSync(join(ws, '..weird.ts'), 'export function weird() {}\n')
  return ws
}

// --- resolveInsideCwd (path sandbox) ---------------------------------------

test('resolveInsideCwd allows in-workspace paths, including legit ..-prefixed names', () => {
  const cwd = '/work/project'
  for (const ok of ['src/a.ts', 'a..b.ts', '..foo.ts', '..config/x.ts', 'sub/../a.ts']) {
    assert.notEqual(resolveInsideCwd(cwd, ok), null, `${ok} is inside the workspace and must resolve`)
  }
})

test('resolveInsideCwd rejects traversal, absolute paths, empty, and non-strings', () => {
  const cwd = '/work/project'
  for (const bad of ['../escape.ts', '..', 'sub/../../escape', '/etc/passwd', '', undefined, null, 42]) {
    assert.equal(resolveInsideCwd(cwd, bad), null, `${String(bad)} must be rejected`)
  }
})

// --- readWorkspaceFile -----------------------------------------------------

test('readWorkspaceFile reads inside cwd (incl. a ..-prefixed filename) and returns null otherwise', async () => {
  const ws = makeWorkspace()
  try {
    assert.match(await readWorkspaceFile(ws, 'a.ts', NOOP_SIGNAL), /export function alpha/)
    // The bug fix end-to-end: a legitimately-named "..weird.ts" is now readable.
    assert.match(await readWorkspaceFile(ws, '..weird.ts', NOOP_SIGNAL), /export function weird/)
    assert.equal(await readWorkspaceFile(ws, '../outside.ts', NOOP_SIGNAL), null, 'traversal -> null')
    assert.equal(await readWorkspaceFile(ws, 'missing.ts', NOOP_SIGNAL), null, 'missing -> null')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('resolveInsideCwd + readWorkspaceFile + indexSingleFile reject an in-tree symlink escaping the workspace', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'codegraph-sym-'))
  const outside = mkdtempSync(join(tmpdir(), 'codegraph-out-'))
  writeFileSync(join(outside, 'secret.ts'), 'export function secret() {}\n')
  // A leaf symlink and a symlinked PARENT directory, both pointing outside.
  symlinkSync(join(outside, 'secret.ts'), join(ws, 'link.ts'))
  symlinkSync(outside, join(ws, 'linkdir'))
  try {
    assert.equal(resolveInsideCwd(ws, 'link.ts'), null, 'a leaf symlink to an outside file must be rejected')
    assert.equal(resolveInsideCwd(ws, 'linkdir/secret.ts'), null, 'a file under a symlinked-out dir must be rejected')
    assert.equal(await readWorkspaceFile(ws, 'link.ts', NOOP_SIGNAL), null, 'readWorkspaceFile must refuse the symlink')
    assert.match((await indexSingleFile(ws, 'link.ts', NOOP_SIGNAL)).error, /outside the workspace/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

// --- indexWorkspace --------------------------------------------------------

test('indexWorkspace lists + indexes supported files (injected lister), filters non-source', async () => {
  const ws = makeWorkspace()
  try {
    const listFiles = async () => ['a.ts', 'b.ts', 'README.md', 'image.png']
    const { index, listError, truncated } = await indexWorkspace({ cwd: ws, signal: NOOP_SIGNAL, listFiles })
    assert.equal(listError, false)
    assert.equal(truncated, false)
    // Only the two .ts files are indexable (md/png filtered by languageForPath).
    assert.deepEqual(Object.keys(index.byFile).sort(), ['a.ts', 'b.ts'])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('indexWorkspace truncates at maxFiles and flags it', async () => {
  const ws = makeWorkspace()
  try {
    const listFiles = async () => ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']
    const { truncated } = await indexWorkspace({ cwd: ws, signal: NOOP_SIGNAL, listFiles, maxFiles: 3 })
    assert.equal(truncated, true)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('indexWorkspace degrades to listError on a real lister failure (signal not aborted)', async () => {
  const ws = makeWorkspace()
  try {
    const listFiles = async () => {
      throw new Error('ripgrep exploded')
    }
    const { index, listError } = await indexWorkspace({ cwd: ws, signal: { aborted: false }, listFiles })
    assert.equal(listError, true)
    assert.deepEqual(Object.keys(index.byFile), []) // empty index, but no throw
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('indexWorkspace propagates a genuine LIST cancellation (does NOT swallow it)', async () => {
  const ws = makeWorkspace()
  try {
    const listFiles = async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    await assert.rejects(
      () => indexWorkspace({ cwd: ws, signal: { aborted: true }, listFiles }),
      /aborted/,
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('indexWorkspace propagates a READ-path cancellation (not silently counted as a skip)', async () => {
  const ws = makeWorkspace()
  try {
    const ac = new AbortController()
    ac.abort()
    // The lister succeeds; the per-file reads run with an already-aborted signal,
    // so readFile rejects with AbortError — which must propagate, not become a skip.
    const listFiles = async () => ['a.ts', 'b.ts']
    await assert.rejects(
      () => indexWorkspace({ cwd: ws, signal: ac.signal, listFiles }),
      e => e?.name === 'AbortError',
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

// --- indexSingleFile -------------------------------------------------------

test('indexSingleFile rejects traversal, missing, and non-regular targets; indexes a real file', async () => {
  const ws = makeWorkspace()
  mkdirSync(join(ws, 'adir'))
  try {
    assert.match((await indexSingleFile(ws, '../escape.ts', NOOP_SIGNAL)).error, /outside the workspace/)
    assert.match((await indexSingleFile(ws, 'nope.ts', NOOP_SIGNAL)).error, /was not found/)
    assert.match((await indexSingleFile(ws, 'adir', NOOP_SIGNAL)).error, /not a regular file/)
    const ok = await indexSingleFile(ws, 'a.ts', NOOP_SIGNAL)
    assert.equal(ok.error, undefined)
    assert.deepEqual(Object.keys(ok.index.byFile), ['a.ts'])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

// --- runCodegraphQuery dispatch --------------------------------------------

function listAll() {
  return async () => ['a.ts', 'b.ts']
}

test('runCodegraphQuery: missing required args return a helpful note (no crash)', async () => {
  const ws = makeWorkspace()
  try {
    const opts = { cwd: ws, signal: NOOP_SIGNAL, listFiles: listAll() }
    assert.match((await runCodegraphQuery({ input: { query: 'list_symbols' }, ...opts })).note, /requires "file"/)
    assert.match((await runCodegraphQuery({ input: { query: 'find_definition' }, ...opts })).note, /requires "name"/)
    assert.match((await runCodegraphQuery({ input: { query: 'importers' }, ...opts })).note, /requires "module"/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runCodegraphQuery list_symbols: lists a file, and reports traversal/empty correctly', async () => {
  const ws = makeWorkspace()
  try {
    const opts = { cwd: ws, signal: NOOP_SIGNAL, listFiles: listAll() }
    const ok = await runCodegraphQuery({ input: { query: 'list_symbols', file: 'a.ts' }, ...opts })
    assert.ok(ok.count >= 1)
    assert.ok(ok.lines.some(l => /alpha/.test(l)))
    const escape = await runCodegraphQuery({ input: { query: 'list_symbols', file: '../x.ts' }, ...opts })
    assert.equal(escape.count, 0)
    assert.match(escape.note, /outside the workspace/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runCodegraphQuery find_definition: candidates + heuristic note, and no-candidates note', async () => {
  const ws = makeWorkspace()
  try {
    const opts = { cwd: ws, signal: NOOP_SIGNAL, listFiles: listAll() }
    const hit = await runCodegraphQuery({ input: { query: 'find_definition', name: 'alpha' }, ...opts })
    assert.ok(hit.count >= 1)
    assert.match(hit.note, /Heuristic candidates/)
    const miss = await runCodegraphQuery({ input: { query: 'find_definition', name: 'doesNotExist' }, ...opts })
    assert.equal(miss.count, 0)
    assert.match(miss.note, /No candidates/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runCodegraphQuery surfaces truncation + lister-failure in the note (no silent incompleteness)', async () => {
  const ws = makeWorkspace()
  try {
    const truncatedRun = await runCodegraphQuery({
      input: { query: 'find_definition', name: 'alpha' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: async () => ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      maxFiles: 2,
    })
    // The note must report the ACTUAL injected cap (2), not the module default
    // (20000) — `more than 2` would also match the buggy "more than 20000" note,
    // so assert on the exact cap instead.
    assert.match(truncatedRun.note, /only the first 2 were indexed/)
    assert.doesNotMatch(truncatedRun.note, /20000/)

    const failRun = await runCodegraphQuery({
      input: { query: 'importers', module: './b.ts' },
      cwd: ws,
      signal: { aborted: false },
      listFiles: async () => {
        throw new Error('rg failed')
      },
    })
    assert.match(failRun.note, /ripgrep failed/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runCodegraphQuery import_graph (with file AND whole-workspace) + importers trace a.ts -> ./b.ts', async () => {
  const ws = makeWorkspace()
  try {
    const opts = { cwd: ws, signal: NOOP_SIGNAL, listFiles: listAll() }
    const graph = await runCodegraphQuery({ input: { query: 'import_graph', file: 'a.ts' }, ...opts })
    assert.ok(graph.lines.some(l => /a\.ts/.test(l) && /b\.ts/.test(l)), 'a.ts imports ./b.ts')
    // The whole-workspace branch (no `file`) exercises indexWorkspace + the graph.
    const wholeGraph = await runCodegraphQuery({ input: { query: 'import_graph' }, ...opts })
    assert.ok(wholeGraph.lines.some(l => /a\.ts/.test(l) && /b\.ts/.test(l)), 'workspace graph includes a.ts -> ./b.ts')
    const importers = await runCodegraphQuery({ input: { query: 'importers', module: './b.ts' }, ...opts })
    assert.ok(importers.lines.some(l => /a\.ts/.test(l)), 'a.ts is an importer of ./b.ts')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runCodegraphQuery list_symbols on an EMPTY file reports the empty-file note', async () => {
  const ws = makeWorkspace()
  writeFileSync(join(ws, 'empty.ts'), '')
  try {
    const r = await runCodegraphQuery({
      input: { query: 'list_symbols', file: 'empty.ts' },
      cwd: ws,
      signal: NOOP_SIGNAL,
      listFiles: listAll(),
    })
    assert.equal(r.count, 0)
    assert.match(r.note, /No symbols found/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('MAX_FILES default is the documented bound', () => {
  assert.equal(MAX_FILES, 20_000)
})

// ── CACHE-MOAT GUARD: CodeGraph is in the DEFAULT DeepSeek tool set (#323) ───
// CodeGraph went default-ON in #323 (opt-OUT via DEEPCODE_DISABLE_CODEGRAPH_TOOL),
// which put it in the default stable-prefix tool manifest — a DELIBERATE one-time
// cache re-warm. getAllBaseTools() lives in a bun-only .ts (needs the bundler's
// path resolution), so we guard the gating at the SOURCE: assert it stays default-
// ON (opt-out), not silently reverted to the old opt-IN gate. A revert would shift
// the DeepSeek stable prefix (collapse/re-warm the cache moat) — this makes that a
// visible, reviewed change rather than a silent one.
test('CodeGraph stays DEFAULT-ON in the base tool set (cache-moat regression guard)', () => {
  const toolsSrc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src/tools.ts'),
    'utf8',
  )
  // opt-OUT semantics: CodeGraph is gated by the DISABLE flag (included UNLESS set)
  // → default-on. Matches both the direct `DISABLE ? [] : [CodegraphTool]` and the
  // equivalent inverted `!DISABLE ? [CodegraphTool] : []` arrangements (both
  // default-on), and survives reformatting — but a revert to the opt-IN ENABLE
  // gate has no DISABLE flag near CodegraphTool, so this fails.
  assert.match(
    toolsSrc,
    /DEEPCODE_DISABLE_CODEGRAPH_TOOL[\s\S]{0,40}\[CodegraphTool\]/,
    'CodeGraph must be opt-OUT (gated by DEEPCODE_DISABLE_CODEGRAPH_TOOL, default-on); a revert to opt-in shifts the DeepSeek stable prefix',
  )
  // the cache-moat rationale must stay documented at the gate.
  assert.match(toolsSrc, /CACHE-MOAT NOTE/, 'the default-on cache-moat rationale must stay documented')
  // and the old opt-IN gate must NOT have crept back in.
  assert.doesNotMatch(
    toolsSrc,
    /isEnvTruthy\(process\.env\.ENABLE_CODEGRAPH_TOOL\)\s*\?\s*\[CodegraphTool\]/,
    'must not regress to the old opt-in ENABLE_CODEGRAPH_TOOL gate',
  )
})
