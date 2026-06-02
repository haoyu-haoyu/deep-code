// Workspace-facing core for the CodeGraph tool: path sandboxing, on-demand
// index building (whole-workspace or single-file), and the query dispatch that
// produces the tool's {query, count, lines, note} result.
//
// This is the pure, dependency-injected core (node builtins + the codegraph
// .mjs modules only) so it is unit-testable under `node --test`. The thin .ts
// tool wrapper (CodegraphTool.ts) injects the real file lister (ripGrep) and cwd
// and adds only the zod schema / ToolDef plumbing.

import { realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { buildIndex } from './indexer.mjs'
import { languageForPath } from './languages.mjs'
import { findDefinition, importGraph, importersOf, listSymbols } from './query.mjs'

// Cap the index so the on-demand build stays bounded on huge repos. The indexer
// additionally skips files larger than its own maxFileBytes.
export const MAX_FILES = 20_000

function isWithin(root, target) {
  const r = relative(root, target)
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !/^([A-Za-z]:)?[\\/]/.test(r))
}

/**
 * Resolve a candidate path against cwd and reject anything that escapes the
 * workspace (absolute paths, `../` traversal, OR a symlink pointing outside).
 * Returns the absolute path when it stays inside cwd, else null.
 *
 * The lexical traversal check matches `..` as a path SEGMENT (`..` itself or a
 * `..<sep>` prefix) — NOT a bare `startsWith('..')`, which would wrongly reject
 * legitimately-named files inside the workspace like `..foo.ts` or `..config/x`.
 *
 * Then it CANONICALIZES (realpath) to defeat symlink escapes: the `file` arg is
 * model-controlled, so an in-tree symlink pointing at an external file must not
 * be readable/indexable. We realpath the deepest existing ancestor (the leaf may
 * not exist) and require the REAL path to stay inside the REAL workspace root.
 *
 * NOTE (residual limitation): callers later open the returned path BY NAME, so a
 * concurrent symlink swap between this check and the open is a check/use TOCTOU.
 * For this read-only, dark-launched indexer that narrow race is acceptable;
 * closing it would require O_NOFOLLOW / fd-based reads.
 */
export function resolveInsideCwd(cwd, rel) {
  if (typeof rel !== 'string' || rel === '') return null
  const root = resolve(cwd)
  const abs = resolve(root, rel)
  const r = relative(root, abs)
  if (r === '' || r === '..' || r.startsWith(`..${sep}`)) return null
  // Absolute path (posix `/…` or Windows `C:\…`) — relative() yields one only
  // when abs is on a different root; treat as outside.
  if (/^([A-Za-z]:)?[\\/]/.test(r)) return null

  let realRoot
  try {
    realRoot = realpathSync(root)
  } catch {
    realRoot = root
  }
  let probe = abs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let realProbe
    try {
      realProbe = realpathSync(probe)
    } catch {
      const parent = dirname(probe)
      // Stop AT the workspace root — never walk above it. If no ancestor
      // at-or-below the root exists (e.g. the cwd itself is absent), there is
      // nothing to canonicalize and the lexical check already passed.
      if (probe === root || parent === probe) break
      probe = parent
      continue
    }
    if (!isWithin(realRoot, realProbe)) return null
    break
  }
  return abs
}

/** Read a workspace-relative UTF-8 file, or null if it escapes cwd / errors. */
export async function readWorkspaceFile(cwd, rel, signal) {
  const abs = resolveInsideCwd(cwd, rel)
  if (!abs) return null
  try {
    // Thread abort so a long index can be cancelled mid-read.
    return await readFile(abs, { encoding: 'utf8', signal })
  } catch (e) {
    // A genuine cancellation must propagate (and not be silently counted as a
    // skipped file); only a real read error degrades to null.
    if (e?.name === 'AbortError' || signal?.aborted) throw e
    return null
  }
}

/**
 * Build a whole-workspace index. `listFiles(args, cwd, signal)` enumerates the
 * tracked files (ripGrep in production; injectable for tests). A genuine
 * cancellation propagates; a real lister failure degrades to `listError` with
 * an empty index. Returns `{ index, listError, truncated }`.
 */
export async function indexWorkspace({ cwd, signal, listFiles, maxFiles = MAX_FILES } = {}) {
  let files = []
  let listError = false
  try {
    files = (await listFiles(['--files'], cwd, signal)).filter(f => languageForPath(f))
  } catch (e) {
    // A genuine cancellation must propagate; only a real lister failure degrades.
    if (signal?.aborted) throw e
    listError = true
  }
  let truncated = false
  if (files.length > maxFiles) {
    files = files.slice(0, maxFiles)
    truncated = true
  }
  const index = await buildIndex({ files, readFile: rel => readWorkspaceFile(cwd, rel, signal) })
  return { index, listError, truncated }
}

/**
 * Build a one-file index after validating the path is inside the workspace AND
 * a regular file (rejects traversal and FIFO/device targets). Returns
 * `{ index, error }` — `error` is a human message when validation fails.
 */
export async function indexSingleFile(cwd, file, signal) {
  const abs = resolveInsideCwd(cwd, file)
  if (!abs) return { index: null, error: `"${file}" is outside the workspace.` }
  try {
    if (!(await stat(abs)).isFile()) {
      return { index: null, error: `"${file}" is not a regular file.` }
    }
  } catch {
    return { index: null, error: `"${file}" was not found.` }
  }
  const index = await buildIndex({ files: [file], readFile: rel => readWorkspaceFile(cwd, rel, signal) })
  return { index, error: undefined }
}

// Surface the file cap so a truncated index never reads as "complete". The note
// reports the ACTUAL cap that was applied (not the module default), so an
// injected maxFiles and the message stay consistent.
const listErrorNote = 'Could not list workspace files (ripgrep failed) — results may be incomplete.'

function truncatedNote(maxFiles) {
  return `Workspace has more than ${maxFiles} indexable files; only the first ${maxFiles} were indexed — results may be incomplete.`
}

function incompleteNote(listError, truncated, maxFiles) {
  if (listError) return listErrorNote
  if (truncated) return truncatedNote(maxFiles)
  return undefined
}

/**
 * Run one CodeGraph query and return the tool result shape
 * `{ query, count, lines, note }`. Pure given an injected `listFiles`; reads
 * only inside `cwd`. Mirrors the four query kinds: list_symbols, find_definition,
 * import_graph, importers.
 */
export async function runCodegraphQuery({ input, cwd, signal, listFiles, maxFiles = MAX_FILES } = {}) {
  const query = input?.query
  const noResult = note => ({ query, count: 0, lines: [], note })
  const lines = []

  if (query === 'list_symbols') {
    if (!input.file) return noResult('list_symbols requires "file".')
    const single = await indexSingleFile(cwd, input.file, signal)
    if (single.error) return noResult(single.error)
    for (const s of listSymbols(single.index, input.file)) {
      lines.push(`${s.line}\t${s.kind}\t${s.exported ? 'export ' : ''}${s.name}${s.scope ? `  (in ${s.scope})` : ''}`)
    }
    const note = lines.length === 0 ? 'No symbols found (unsupported language or empty file).' : undefined
    return { query, count: lines.length, lines, note }
  }

  if (query === 'find_definition') {
    if (!input.name) return noResult('find_definition requires "name".')
    const { index, listError, truncated } = await indexWorkspace({ cwd, signal, listFiles, maxFiles })
    for (const h of findDefinition(index, input.name)) {
      lines.push(`${h.file}:${h.line}\t${h.name}\t(${h.why}; confidence ${h.confidence})`)
    }
    const note =
      incompleteNote(listError, truncated, maxFiles) ??
      (lines.length === 0
        ? `No candidates for "${input.name}".`
        : 'Heuristic candidates — verify with Read before relying on a single hit.')
    return { query, count: lines.length, lines, note }
  }

  if (query === 'import_graph') {
    let listError = false
    let truncated = false
    let index
    if (input.file) {
      const single = await indexSingleFile(cwd, input.file, signal)
      if (single.error) return noResult(single.error)
      index = single.index
    } else {
      ;({ index, listError, truncated } = await indexWorkspace({ cwd, signal, listFiles, maxFiles }))
    }
    const graph = importGraph(index, input.file ? { file: input.file } : {})
    for (const [file, modules] of Object.entries(graph)) {
      lines.push(`${file} → ${modules.join(', ')}`)
    }
    const note = incompleteNote(listError, truncated, maxFiles) ?? (lines.length === 0 ? 'No imports found.' : undefined)
    return { query, count: lines.length, lines, note }
  }

  // importers
  if (!input.module) return noResult('importers requires "module".')
  const { index, listError, truncated } = await indexWorkspace({ cwd, signal, listFiles, maxFiles })
  for (const { file, modules } of importersOf(index, input.module)) {
    lines.push(`${file}\t(${modules.join(', ')})`)
  }
  const note =
    incompleteNote(listError, truncated, maxFiles) ??
    (lines.length === 0 ? `No files import "${input.module}".` : undefined)
  return { query, count: lines.length, lines, note }
}
