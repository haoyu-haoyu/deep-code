// Cross-call cache + single-flight for the whole-workspace CodeGraph index.
//
// The uncached indexWorkspace (workspace.mjs) re-lists AND re-reads+parses up to
// MAX_FILES (20k) files on EVERY find_definition / importers / whole-workspace
// import_graph call. That made CodeGraph the one read tool that could not run
// concurrently (a parallel fan-out would multiply full-repo I/O), so its tool
// wrapper hard-coded isConcurrencySafe() = false.
//
// This module fixes both, correctness-first:
//   - INCREMENTAL: every call still re-lists and re-stats (so a file edited
//     between two queries is always seen), but the expensive read+parse is
//     skipped for any file whose (mtimeMs, size) is unchanged — its prior extract
//     is reused. Only changed/new files are re-read, via buildIndex (the single
//     source of truth for the extract + skip rules). Deleted files fall out
//     because the per-file cache is rebuilt from the current listing each call.
//   - SINGLE-FLIGHT: concurrent callers for the same workspace share ONE in-flight
//     build instead of each launching a full scan. This is what makes
//     isConcurrencySafe() = true safe — the index is read-only once built, and
//     concurrency no longer multiplies I/O.
//
// It never serves a result without re-validating against the filesystem, so it
// cannot hand the agent a stale view of the code it is editing.

import { buildIndex } from './indexer.mjs'
import { languageForPath } from './languages.mjs'

/** @typedef {{ mtimeMs: number, size: number, extracted: import('./indexer.mjs').CodegraphIndex['byFile'][string] }} FileCacheEntry */

// Per-workspace cache of file extracts, keyed by cwd. A process serves one (or a
// handful of) workspaces, so this stays tiny; entries for a cwd are fully replaced
// on each successful build (so it never accumulates deleted files).
/** @type {Map<string, Map<string, FileCacheEntry>>} */
const fileCaches = new Map()

// In-flight builds, keyed by cwd — the single-flight coalescing point.
/** @type {Map<string, Promise<{ index: import('./indexer.mjs').CodegraphIndex, listError: boolean, truncated: boolean }>>} */
const inFlight = new Map()

// LRU bound on the cwd axis. A process usually serves one workspace, but
// runWithCwdOverride / --worktree / subagent fan-out can legitimately touch a few
// distinct cwds; cap the retained set so memory stays bounded (each evicted cwd
// just pays one cold rebuild on its next query — never a correctness cost).
const MAX_CACHED_WORKSPACES = 8

/** Test hook: drop all cached state so module-scope caching can't leak across tests. */
export function __resetCodegraphWorkspaceCache() {
  fileCaches.clear()
  inFlight.clear()
}

function emptyIndex() {
  return { byFile: Object.create(null), byName: Object.create(null), fileCount: 0, skipped: 0 }
}

function abortError() {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

/**
 * Whole-workspace index with cross-call caching + single-flight. Drop-in for
 * indexWorkspace, plus an injected `statFile(rel) -> {mtimeMs,size}|null` used to
 * detect unchanged files. `listFiles(args, cwd, signal)` and
 * `readFile(rel) -> string|null` match indexWorkspace's injections.
 *
 * @returns {Promise<{ index: import('./indexer.mjs').CodegraphIndex, listError: boolean, truncated: boolean }>}
 */
export async function indexWorkspaceCached({ cwd, signal, listFiles, statFile, readFile, maxFiles } = {}) {
  const key = String(cwd)
  // Coalesce concurrent builds for the same workspace onto one promise.
  const existing = inFlight.get(key)
  if (existing) return existing

  const build = doBuild({ key, cwd, signal, listFiles, statFile, readFile, maxFiles })
  inFlight.set(key, build)
  try {
    return await build
  } finally {
    // Clear so the NEXT (sequential) call re-validates against the filesystem.
    inFlight.delete(key)
  }
}

async function doBuild({ key, cwd, signal, listFiles, statFile, readFile, maxFiles }) {
  let listing
  try {
    listing = (await listFiles(['--files'], cwd, signal)).filter(f => languageForPath(f))
  } catch (e) {
    // A genuine cancellation propagates; a transient lister failure degrades to an
    // empty index WITHOUT clobbering the warm cache, so the next success can reuse.
    if (signal?.aborted) throw e
    return { index: emptyIndex(), listError: true, truncated: false }
  }

  let truncated = false
  let files = listing
  if (files.length > maxFiles) {
    files = files.slice(0, maxFiles)
    truncated = true
  }

  const prev = fileCaches.get(key) ?? new Map()
  const reusedByPath = new Map() // path -> { extracted, st }
  const changedStats = new Map() // path -> st | null
  const changedPaths = []
  for (const path of files) {
    if (signal?.aborted) throw abortError()
    let st = null
    try {
      st = await statFile(path)
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) throw e
      st = null
    }
    const cached = prev.get(path)
    if (st && cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      reusedByPath.set(path, { extracted: cached.extracted, st })
    } else {
      changedPaths.push(path)
      changedStats.set(path, st)
    }
  }

  // Re-read + parse ONLY the changed/new files. buildIndex owns the read/skip/
  // extract rules (empty, >maxFileBytes, unreadable, unsupported) — we never
  // duplicate them, so the cached path can't drift from the uncached one.
  const fresh = await buildIndex({ files: changedPaths, readFile })

  // Assemble in LISTING order (one pass over `files`, pulling each extract from
  // the reused map or the fresh build) — NOT reused-then-changed. This keeps
  // byFile/byName iteration order byte-identical to the uncached indexWorkspace
  // AND stable across warm/cold builds, so whole-workspace import_graph (which
  // emits lines in byFile order) doesn't reorder when a file is edited.
  const byFile = Object.create(null)
  const byName = Object.create(null)
  const next = new Map()
  for (const path of files) {
    const reused = reusedByPath.get(path)
    let extracted
    let st
    if (reused) {
      extracted = reused.extracted
      st = reused.st
    } else {
      extracted = fresh.byFile[path]
      if (!extracted) continue // skipped by buildIndex (empty/large/unreadable)
      st = changedStats.get(path)
    }
    byFile[path] = extracted
    // Only memoize when we have a stat to validate against next time; a stat-less
    // file (deleted/raced) is still indexed this round but not cached.
    if (st) next.set(path, { mtimeMs: st.mtimeMs, size: st.size, extracted })
    for (const sym of extracted.symbols) {
      ;(byName[sym.name.toLowerCase()] ??= []).push({ ...sym, file: path })
    }
  }

  // Update the cache (LRU on the cwd axis): drop+re-insert so this cwd is the
  // most-recent key, then evict the oldest while over the cap.
  fileCaches.delete(key)
  fileCaches.set(key, next)
  while (fileCaches.size > MAX_CACHED_WORKSPACES) {
    fileCaches.delete(fileCaches.keys().next().value)
  }

  const index = { byFile, byName, fileCount: Object.keys(byFile).length, skipped: fresh.skipped }
  return { index, listError: false, truncated }
}
