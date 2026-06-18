// When time-based microcompact clears an old FileRead tool result, it normally
// replaces the whole file body with a bare sentinel ('[Old tool result content
// cleared]'). That leaves ZERO structural residue, so the model often re-reads
// the same file just to recall what was in it. This leaf turns the cleared body
// into a bounded STRUCTURAL digest — the file's declared symbol names — so the
// model can often answer "where is X" without paying to re-read.
//
// Pure and dependency-light (the heuristic codegraph extractor only). It is given
// the RAW source (the caller strips the cat -n line-number prefixes first, via
// the SSOT stripLineNumberPrefix), and returns null whenever nothing useful can
// be derived (non-source file, no declarations, empty/offset-past-EOF reads) — the
// caller then falls back to the plain sentinel.

import { extractFile, languageForPath } from '../../utils/codegraph/languages.mjs'

// Shared leading text of BOTH the plain cleared sentinel and a digest, so the
// clear path can recognize an already-cleared result (idempotency) by prefix and
// never re-process or double-count it. The plain sentinel
// ('[Old tool result content cleared]') and every digest start with this.
export const CLEARED_PREFIX = '[Old tool result content cleared'

const DEFAULT_MAX_SYMBOLS = 16

/**
 * Whether a tool_result content is one we already wrote — the plain sentinel
 * (`CLEARED_PREFIX + ']'`) or a digest (`CLEARED_PREFIX + ' - …]'`). Matching the
 * exact two shapes (not a bare CLEARED_PREFIX startsWith) keeps a real, uncleared
 * result that merely happens to begin with this phrase from being mistaken for an
 * already-cleared one and skipped.
 * @param {unknown} content
 * @returns {boolean}
 */
export function isClearedToolResultContent(content) {
  return (
    typeof content === 'string' &&
    (content.startsWith(`${CLEARED_PREFIX}]`) || content.startsWith(`${CLEARED_PREFIX} - `))
  )
}

function basename(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * Build a one-line structural digest for a cleared FileRead result.
 *
 * @param {string} filePath  the FileRead file_path (used for language detection + the label)
 * @param {string} rawSource the file source WITH line-number prefixes already stripped
 * @param {{ maxSymbols?: number, partial?: boolean }} [opts]  partial=true for an
 *   offset/limit read, so the digest is labelled a window (it lists only the
 *   symbols in the slice, not necessarily the whole file)
 * @returns {string|null} the digest line (starts with CLEARED_PREFIX), or null to
 *   fall back to the plain sentinel
 */
export function buildFileReadSymbolDigest(
  filePath,
  rawSource,
  { maxSymbols = DEFAULT_MAX_SYMBOLS, partial = false } = {},
) {
  if (typeof filePath !== 'string' || typeof rawSource !== 'string') return null
  // Only source files the heuristic indexer understands; anything else (.txt,
  // .md, .json, a PDF metadata string, …) yields no symbols anyway.
  if (!languageForPath(filePath)) return null

  const extracted = extractFile(filePath, rawSource)
  if (!extracted || !Array.isArray(extracted.symbols) || extracted.symbols.length === 0) {
    return null
  }

  // Distinct declared names in source order (a method and a function can share a
  // name; overloads repeat — show each once to keep the digest tight).
  const names = []
  const seen = new Set()
  for (const sym of extracted.symbols) {
    const name = sym?.name
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (names.length === 0) return null

  const shown = names.slice(0, Math.max(1, maxSymbols))
  const more = names.length - shown.length
  const suffix = more > 0 ? ` (+${more} more)` : ''
  // A partial (offset/limit) read only saw a window, so the symbol list is not
  // the whole file — label it so the digest doesn't over-claim completeness.
  const window = partial ? ' (partial read)' : ''
  return `${CLEARED_PREFIX} - ${basename(filePath)}${window} defines: ${shown.join(', ')}${suffix}]`
}
