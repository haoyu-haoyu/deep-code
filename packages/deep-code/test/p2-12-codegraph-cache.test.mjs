import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  indexWorkspaceCached,
  __resetCodegraphWorkspaceCache,
} from '../src/utils/codegraph/workspaceCache.mjs'
import { runCodegraphQuery } from '../src/utils/codegraph/workspace.mjs'

// The cross-call cache + single-flight that lets CodeGraph run concurrently
// without each query re-reading the whole repo. These tests inject fake
// list/stat/read so call counts are exact and deterministic — no real-fs mtime
// granularity flakiness. A separate integration test exercises the real-fs path
// through runCodegraphQuery({ useCache: true }).

// A fake workspace: a path -> {content, mtimeMs, size} store plus call counters.
function makeFakeWs(initial = {}) {
  const store = new Map()
  for (const [path, content] of Object.entries(initial)) {
    store.set(path, { content, mtimeMs: 1000, size: content.length })
  }
  const counts = { list: 0, stat: 0, read: 0 }
  let failList = false
  const harness = {
    store,
    counts,
    setFailList(v) {
      failList = v
    },
    edit(path, content) {
      const prev = store.get(path)
      store.set(path, { content, mtimeMs: (prev?.mtimeMs ?? 1000) + 50, size: content.length })
    },
    touch(path) {
      // change mtime only (content/size identical) — must still be treated as fresh
      const prev = store.get(path)
      if (prev) store.set(path, { ...prev, mtimeMs: prev.mtimeMs + 50 })
    },
    remove(path) {
      store.delete(path)
    },
    listFiles: async () => {
      counts.list++
      if (failList) throw new Error('ripgrep blew up')
      return [...store.keys()]
    },
    statFile: async path => {
      counts.stat++
      const f = store.get(path)
      return f ? { mtimeMs: f.mtimeMs, size: f.size } : null
    },
    readFile: async path => {
      counts.read++
      const f = store.get(path)
      return f ? f.content : null
    },
  }
  return harness
}

const run = (ws, { cwd = '/ws', signal, maxFiles = 100 } = {}) =>
  indexWorkspaceCached({
    cwd,
    signal,
    maxFiles,
    listFiles: ws.listFiles,
    statFile: ws.statFile,
    readFile: ws.readFile,
  })

beforeEach(() => __resetCodegraphWorkspaceCache())

test('first build reads every file; a second unchanged build re-stats but re-reads NOTHING', async () => {
  const ws = makeFakeWs({
    'a.ts': 'export function alpha() {}',
    'b.ts': 'export function beta() {}',
  })

  const first = await run(ws)
  assert.equal(first.index.fileCount, 2)
  assert.equal(ws.counts.read, 2, 'first build reads both files')

  const readsAfterFirst = ws.counts.read
  const statsAfterFirst = ws.counts.stat
  const second = await run(ws)
  assert.equal(second.index.fileCount, 2)
  assert.equal(ws.counts.read - readsAfterFirst, 0, 'unchanged second build re-reads nothing')
  assert.equal(ws.counts.stat - statsAfterFirst, 2, 'but it DID re-stat both files (revalidation)')
  // same symbols both times
  assert.deepEqual(Object.keys(second.index.byFile).sort(), ['a.ts', 'b.ts'])
})

test('an edited file (changed mtime+size) is re-read; untouched files are reused', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export function alpha() {}', 'b.ts': 'export function beta() {}' })
  await run(ws)
  const readsBefore = ws.counts.read

  ws.edit('a.ts', 'export function alphaRenamed() {}')
  const after = await run(ws)

  assert.equal(ws.counts.read - readsBefore, 1, 'only the edited file is re-read')
  assert.ok(after.index.byName['alpharenamed'], 'the new symbol is indexed')
  assert.ok(!after.index.byName['alpha'], 'the old symbol is gone')
  assert.ok(after.index.byName['beta'], 'the untouched file’s symbols survive')
})

test('a same-size content change is caught because mtime moved', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export const xx = 1' })
  await run(ws)
  const readsBefore = ws.counts.read
  // same length, different content, bumped mtime
  ws.edit('a.ts', 'export const yy = 2')
  const after = await run(ws)
  assert.equal(ws.counts.read - readsBefore, 1, 'mtime change forces a re-read even at equal size')
  assert.ok(after.index.byName['yy'] && !after.index.byName['xx'])
})

test('a deleted file is evicted from the index and the cache', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export function alpha() {}', 'b.ts': 'export function beta() {}' })
  await run(ws)
  ws.remove('b.ts')
  const after = await run(ws)
  assert.deepEqual(Object.keys(after.index.byFile), ['a.ts'])
  assert.ok(!after.index.byName['beta'], 'deleted file’s symbols are gone')

  // re-adding b.ts re-reads it (it was evicted from the cache, not lingering)
  const readsBefore = ws.counts.read
  ws.store.set('b.ts', { content: 'export function beta() {}', mtimeMs: 2000, size: 25 })
  const readded = await run(ws)
  assert.equal(ws.counts.read - readsBefore, 1, 'the re-added file is read again')
  assert.ok(readded.index.byName['beta'])
})

test('byFile keeps LISTING order after an incremental rebuild (parity, not reused-first)', async () => {
  const ws = makeFakeWs({
    'a.ts': 'export const a = 1',
    'b.ts': 'export const b = 1',
    'c.ts': 'export const c = 1',
  })
  await run(ws)
  // edit the MIDDLE file — a naive reused-then-changed merge would reorder it last
  ws.edit('b.ts', 'export const bb = 2')
  const after = await run(ws)
  assert.deepEqual(
    Object.keys(after.index.byFile),
    ['a.ts', 'b.ts', 'c.ts'],
    'index iteration order matches the listing, independent of which file changed',
  )
})

test('caps the number of cached workspaces (cwd-axis LRU, no unbounded growth)', async () => {
  // Touch many distinct cwds; the cache must not retain all of them.
  for (let i = 0; i < 20; i++) {
    const ws = makeFakeWs({ 'a.ts': `export const v${i} = 1` })
    await run(ws, { cwd: `/ws-${i}` })
  }
  // Re-querying the most-recent cwd should still be warm (no re-read), while the
  // oldest must have been evicted (cold re-read). We verify the oldest is cold:
  const oldest = makeFakeWs({ 'a.ts': 'export const v0 = 1' })
  await run(oldest, { cwd: '/ws-0' })
  assert.equal(oldest.counts.read, 1, 'the oldest cwd was evicted → cold rebuild reads the file')
})

test('single-flight: concurrent builds for one workspace share ONE build', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export function alpha() {}', 'b.ts': 'export function beta() {}' })
  // Fire two without awaiting between them — the second must coalesce onto the first.
  const p1 = run(ws)
  const p2 = run(ws)
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(ws.counts.list, 1, 'listed once')
  assert.equal(ws.counts.read, 2, 'read each file once (not 4)')
  assert.equal(r1.index, r2.index, 'both callers got the very same index object')
})

test('single-flight clears after settle: a later sequential call rebuilds (re-validates)', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export const a = 1' })
  await run(ws)
  assert.equal(ws.counts.list, 1)
  await run(ws)
  assert.equal(ws.counts.list, 2, 'the sequential call re-listed (cache is revalidated, not frozen)')
})

test('a transient lister failure yields an empty index + listError, and does NOT clobber the warm cache', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export function alpha() {}' })
  await run(ws) // warm the cache
  const readsBefore = ws.counts.read

  ws.setFailList(true)
  const failed = await run(ws)
  assert.equal(failed.listError, true)
  assert.equal(failed.index.fileCount, 0, 'empty index on lister failure')

  // recover: the warm cache survived, so the file is NOT re-read
  ws.setFailList(false)
  const recovered = await run(ws)
  assert.equal(recovered.index.fileCount, 1)
  assert.equal(ws.counts.read - readsBefore, 0, 'warm cache preserved across the transient failure')
})

test('truncation past maxFiles is reported and bounds the index', async () => {
  const ws = makeFakeWs({
    'a.ts': 'export const a = 1',
    'b.ts': 'export const b = 1',
    'c.ts': 'export const c = 1',
  })
  const res = await run(ws, { maxFiles: 2 })
  assert.equal(res.truncated, true)
  assert.equal(res.index.fileCount, 2)
})

test('an aborted signal rejects (does not silently treat every file as changed)', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export const a = 1' })
  await assert.rejects(
    () => run(ws, { signal: { aborted: true } }),
    e => e?.name === 'AbortError',
  )
})

test('caches are keyed per cwd (no cross-workspace leakage)', async () => {
  const wsA = makeFakeWs({ 'a.ts': 'export function fromA() {}' })
  const wsB = makeFakeWs({ 'a.ts': 'export function fromB() {}' })
  const a = await run(wsA, { cwd: '/wsA' })
  const b = await run(wsB, { cwd: '/wsB' })
  assert.ok(a.index.byName['froma'] && !a.index.byName['fromb'])
  assert.ok(b.index.byName['fromb'] && !b.index.byName['froma'])
})

test('__resetCodegraphWorkspaceCache forces a cold rebuild', async () => {
  const ws = makeFakeWs({ 'a.ts': 'export const a = 1' })
  await run(ws)
  const readsBefore = ws.counts.read
  __resetCodegraphWorkspaceCache()
  await run(ws)
  assert.equal(ws.counts.read - readsBefore, 1, 'after reset the file is read again (cache dropped)')
})

// ── integration: runCodegraphQuery({ useCache: true }) over a REAL workspace ──
// Exercises the production closure wiring (statWorkspaceFile + readWorkspaceFile
// on the real fs) — not just the injected-fake unit path above.

test('runCodegraphQuery useCache: correct results, reflects on-disk edits, single-flight', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'codegraph-cache-'))
  // injected lister returns workspace-relative paths (as ripGrep --files would)
  const listFiles = async () => ['a.ts', 'b.ts']
  const query = (input, signal = { aborted: false }) =>
    runCodegraphQuery({ input, cwd: ws, signal, listFiles, useCache: true })
  try {
    writeFileSync(join(ws, 'a.ts'), "import { beta } from './b.ts'\nexport function alpha() {}\n")
    writeFileSync(join(ws, 'b.ts'), 'export function beta() {}\n')

    const def1 = await query({ query: 'find_definition', name: 'beta' })
    assert.equal(def1.count, 1)
    assert.match(def1.lines[0], /^b\.ts:1\tbeta/)

    // a second query reuses the warm cache and stays correct
    const importers = await query({ query: 'importers', module: 'b.ts' })
    assert.ok(importers.lines.some(l => l.startsWith('a.ts')), 'a.ts imports b.ts')

    // edit b.ts on disk (different SIZE so it invalidates regardless of mtime
    // granularity) — the cache must reflect the new symbol, not a stale one
    writeFileSync(join(ws, 'b.ts'), 'export function betaRenamedLonger() {}\n')
    const def2 = await query({ query: 'find_definition', name: 'betaRenamedLonger' })
    assert.equal(def2.count, 1, 'edited symbol is found (cache revalidated against disk)')
    const stale = await query({ query: 'find_definition', name: 'beta' })
    assert.equal(stale.count, 0, 'the old symbol is gone — no stale cache hit')

    // concurrent queries coalesce and both return correct results
    const [c1, c2] = await Promise.all([
      query({ query: 'find_definition', name: 'alpha' }),
      query({ query: 'find_definition', name: 'alpha' }),
    ])
    assert.equal(c1.count, 1)
    assert.equal(c2.count, 1)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
