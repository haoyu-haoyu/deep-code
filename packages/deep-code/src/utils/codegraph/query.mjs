// Pure queries over a CodegraphIndex. These return ranked CANDIDATES with a
// confidence + reason — never a single "resolved" binding, because the index
// is heuristic (no scope/shadowing resolution). Callers (and the agent) must
// treat results as leads to verify, not ground truth.

/**
 * Symbols declared in a file, in source order.
 * @param {import('./indexer.mjs').CodegraphIndex} index
 * @param {string} file
 * @returns {import('./languages.mjs').SymbolRecord[]}
 */
export function listSymbols(index, file) {
  return index.byFile[file]?.symbols ?? []
}

/** Imports of a file, in source order. */
export function importsOf(index, file) {
  return index.byFile[file]?.imports ?? []
}

/**
 * Candidate declarations for a symbol name, ranked best-first.
 *
 * Ranking (higher = better): exact-case match, exported, top-level scope, and
 * a small preference for declaration kinds over var bindings/methods. Ties
 * break by file path for determinism.
 *
 * @param {import('./indexer.mjs').CodegraphIndex} index
 * @param {string} name
 * @param {{ limit?: number }} [options]
 * @returns {Array<import('./indexer.mjs').SymbolRef & { confidence: number, why: string }>}
 */
export function findDefinition(index, name, { limit = 20 } = {}) {
  const wanted = String(name ?? '').trim()
  if (wanted === '') return []
  const candidates = index.byName[wanted.toLowerCase()] ?? []

  const ranked = candidates.map(ref => {
    const reasons = []
    let score = 0
    if (ref.name === wanted) { score += 100; reasons.push('exact name') }
    else reasons.push('case-insensitive match')
    if (ref.exported) { score += 50; reasons.push('exported') }
    if (ref.scope === '') { score += 20; reasons.push('top-level') }
    else reasons.push(`in ${ref.scope}`)
    if (ref.kind !== 'const' && ref.kind !== 'let' && ref.kind !== 'var' && ref.kind !== 'method') {
      score += 5
    }
    return { ...ref, confidence: score, why: `${ref.kind}, ${reasons.join(', ')}` }
  })

  ranked.sort((a, b) => b.confidence - a.confidence || a.file.localeCompare(b.file) || a.line - b.line)
  return ranked.slice(0, limit)
}

/**
 * The import graph as { file -> [module specifiers] }. Optionally restricted to
 * one file. Specifiers are verbatim (relative paths unresolved — resolving them
 * to real files needs module-resolution we intentionally don't do here).
 *
 * @param {import('./indexer.mjs').CodegraphIndex} index
 * @param {{ file?: string }} [options]
 * @returns {Record<string, string[]>}
 */
export function importGraph(index, { file } = {}) {
  const graph = {}
  const entries = file
    ? (index.byFile[file] ? [[file, index.byFile[file]]] : [])
    : Object.entries(index.byFile)
  for (const [path, data] of entries) {
    const modules = [...new Set(data.imports.map(i => i.module))]
    if (modules.length) graph[path] = modules
  }
  return graph
}

/**
 * Files that import a module matching `specifier`. Matches a full specifier or
 * its trailing path segment (so "utils/foo" matches "../utils/foo" and
 * "./foo" matches "foo"), letting the agent ask "who imports X" without exact
 * relative paths. Returns { file, modules } per importer.
 *
 * @param {import('./indexer.mjs').CodegraphIndex} index
 * @param {string} specifier
 * @returns {Array<{ file: string, modules: string[] }>}
 */
export function importersOf(index, specifier) {
  const needle = String(specifier ?? '').trim()
  if (needle === '') return []
  const lower = needle.toLowerCase()
  const results = []
  for (const [path, data] of Object.entries(index.byFile)) {
    const matched = data.imports
      .map(i => i.module)
      .filter(m => moduleMatches(m.toLowerCase(), lower))
    if (matched.length) results.push({ file: path, modules: [...new Set(matched)] })
  }
  results.sort((a, b) => a.file.localeCompare(b.file))
  return results
}

const JS_EXT_RE = /\.[cm]?[jt]sx?$/

function moduleMatches(module, needle) {
  if (module === needle) return true
  // Only strip extensions when the NEEDLE omitted one — so `foo` matches
  // `./foo.ts`, but `foo.js` does NOT match `foo.ts` (extensions must agree
  // when the caller specified one). Then compare on the trailing path segment
  // so `foo` matches `../x/foo` but never `barfoo`.
  const needleHasExt = JS_EXT_RE.test(needle)
  const modBase = needleHasExt ? module : module.replace(JS_EXT_RE, '')
  const needleBase = needle
  if (modBase === needleBase) return true
  if (modBase.endsWith('/' + needleBase)) return true
  return false
}
