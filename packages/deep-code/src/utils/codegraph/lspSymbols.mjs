// Pure mapping from LSP symbol results to the CodeGraph tool's line format, so an
// LSP-resolved answer reads identically to the heuristic one. No I/O, no LSP
// dependency — it takes the plain result objects an LSP server returns
// (SymbolInformation[] for workspace/symbol, DocumentSymbol[] | SymbolInformation[]
// for textDocument/documentSymbol) and returns formatted lines. The .ts resolver
// that actually talks to the LSP manager feeds these; this stays unit-testable.

import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'

// LSP SymbolKind (vscode-languageserver-types) numeric enum → a short label,
// matching the vocabulary the heuristic index uses where they overlap.
const SYMBOL_KIND_NAMES = Object.freeze({
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
  7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface',
  12: 'function', 13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
  17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null',
  22: 'enum-member', 23: 'struct', 24: 'event', 25: 'operator', 26: 'type-param',
})

function kindName(kind) {
  return SYMBOL_KIND_NAMES[kind] ?? 'symbol'
}

// A workspace-relative path for a `file://` URI (CodeGraph reports relative paths).
// Falls back to the raw uri if it isn't a parseable file URL.
function uriToRelative(uri, cwd) {
  if (typeof uri !== 'string') return ''
  // Only filesystem-backed file: URIs are relativized; a non-file URI (untitled:,
  // vscode-notebook-cell:, …) or a malformed one is returned verbatim — never run
  // through relative(), which would emit a garbled pseudo-path.
  if (!uri.startsWith('file:')) return uri
  let abs
  try {
    abs = fileURLToPath(uri)
  } catch {
    return uri
  }
  const rel = relative(cwd, abs)
  return rel === '' ? abs : rel
}

// LSP positions are 0-based; CodeGraph (like editors) shows 1-based lines.
function lineOf(symbol) {
  // SymbolInformation: location.range.start.line; DocumentSymbol: range.start.line
  const line =
    symbol?.location?.range?.start?.line ?? symbol?.range?.start?.line ?? symbol?.selectionRange?.start?.line
  return Number.isInteger(line) ? line + 1 : 1
}

/**
 * Map workspace/symbol results (SymbolInformation[]) to find_definition lines:
 *   `<relpath>:<line>\t<name>\t(LSP <kind>)`
 * Ranked by path then line for determinism, deduped. Returns { lines, count }.
 *
 * `nameFilter` (when given) keeps only exact (case-insensitive) name matches —
 * preserving find_definition's by-name contract, since workspace/symbol is fuzzy
 * on many servers (a query for "foo" may return "fooBar", "foobar2", …).
 * @param {unknown} symbols
 * @param {string} cwd
 * @param {{ nameFilter?: string }} [opts]
 */
export function mapWorkspaceSymbolsToLines(symbols, cwd, { nameFilter } = {}) {
  if (!Array.isArray(symbols)) return { lines: [], count: 0 }
  const wanted = typeof nameFilter === 'string' ? nameFilter.toLowerCase() : null
  const seen = new Set()
  const rows = []
  for (const s of symbols) {
    if (!s || typeof s.name !== 'string') continue
    if (wanted !== null && s.name.toLowerCase() !== wanted) continue
    const file = uriToRelative(s.location?.uri, cwd)
    const line = lineOf(s)
    const key = `${file}:${line}:${s.name}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ file, line, name: s.name, kind: kindName(s.kind), container: s.containerName })
  }
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name))
  const lines = rows.map(
    r => `${r.file}:${r.line}\t${r.name}\t(LSP ${r.kind}${r.container ? ` in ${r.container}` : ''})`,
  )
  return { lines, count: lines.length }
}

/**
 * Flatten a documentSymbol result (DocumentSymbol[] is nested with `children`;
 * SymbolInformation[] is flat). Each entry: { name, kind, line, scope }. Children
 * carry their parent's name as `scope` (matching the heuristic's "(in scope)").
 * @param {unknown} symbols
 * @param {string} [scope]
 * @returns {Array<{name:string,kind:string,line:number,scope:string}>}
 */
export function flattenDocumentSymbols(symbols, scope = '') {
  if (!Array.isArray(symbols)) return []
  const out = []
  for (const s of symbols) {
    if (!s || typeof s.name !== 'string') continue
    // DocumentSymbol nests via `children`; the legacy flat SymbolInformation[] form
    // nests via `containerName` — honor it so scope survives on either shape.
    const effectiveScope =
      scope || (typeof s.containerName === 'string' ? s.containerName : '')
    out.push({ name: s.name, kind: kindName(s.kind), line: lineOf(s), scope: effectiveScope })
    if (Array.isArray(s.children) && s.children.length > 0) {
      out.push(...flattenDocumentSymbols(s.children, s.name))
    }
  }
  return out
}

/**
 * Map a documentSymbol result to list_symbols lines, in source order:
 *   `<line>\t<kind>\t<name>[  (in <scope>)]`
 * Returns { lines, count }.
 * @param {unknown} symbols
 */
export function mapDocumentSymbolsToLines(symbols) {
  const flat = flattenDocumentSymbols(symbols)
  const lines = flat.map(s => `${s.line}\t${s.kind}\t${s.name}${s.scope ? `  (in ${s.scope})` : ''}`)
  return { lines, count: lines.length }
}
