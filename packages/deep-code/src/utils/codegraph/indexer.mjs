// Pure codegraph indexer. Dependency-injected: the caller supplies the file
// list and a readFile function, so this module has zero I/O and is fully
// unit-testable (and safe in the standalone binary — no native deps). The
// .ts tool wrapper is responsible for enumerating files (ripgrep / fs) and
// providing readFile.

import { extractFile, languageForPath } from './languages.mjs'

/**
 * @typedef {import('./languages.mjs').SymbolRecord & { file: string }} SymbolRef
 */

/**
 * @typedef {Object} CodegraphIndex
 * @property {Record<string, { symbols: import('./languages.mjs').SymbolRecord[], imports: import('./languages.mjs').ImportRecord[] }>} byFile
 * @property {Record<string, SymbolRef[]>} byName  keyed by LOWERCASED symbol name
 * @property {number} fileCount  number of indexed (supported, readable) files
 * @property {number} skipped    files skipped (unsupported/unreadable/too large)
 */

/**
 * Build a codegraph index over the given files.
 *
 * @param {Object} options
 * @param {string[]} options.files  candidate file paths (already gitignore-filtered by the caller)
 * @param {(path: string) => Promise<string|null|undefined>|string|null|undefined} options.readFile
 * @param {number} [options.maxFileBytes]  skip files larger than this (default 2MB)
 * @returns {Promise<CodegraphIndex>}
 */
export async function buildIndex({ files, readFile, maxFileBytes = 2_000_000 }) {
  if (!Array.isArray(files)) throw new TypeError('buildIndex requires a files array')
  if (typeof readFile !== 'function') throw new TypeError('buildIndex requires a readFile function')

  // Null-prototype maps: symbol names like "constructor"/"toString"/"__proto__"
  // would otherwise collide with Object.prototype members (a symbol named
  // "constructor" — i.e. every class constructor — would read back the
  // prototype function instead of undefined and crash the ??=/lookups).
  /** @type {CodegraphIndex['byFile']} */
  const byFile = Object.create(null)
  /** @type {CodegraphIndex['byName']} */
  const byName = Object.create(null)
  let skipped = 0

  for (const path of files) {
    if (!languageForPath(path)) { skipped++; continue }
    let text
    try {
      text = await readFile(path)
    } catch {
      skipped++
      continue
    }
    if (typeof text !== 'string' || text.length === 0 || text.length > maxFileBytes) {
      skipped++
      continue
    }
    const extracted = extractFile(path, text)
    if (!extracted) { skipped++; continue }

    byFile[path] = extracted
    for (const sym of extracted.symbols) {
      const key = sym.name.toLowerCase()
      ;(byName[key] ??= []).push({ ...sym, file: path })
    }
  }

  return { byFile, byName, fileCount: Object.keys(byFile).length, skipped }
}
