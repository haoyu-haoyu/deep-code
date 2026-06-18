// LSP-backed resolver for the CodeGraph tool. When a language server is connected
// it answers list_symbols / find_definition authoritatively (real AST/scope
// resolution) instead of the line-oriented regex heuristic; on ANY miss
// (not connected, no server for the file's language, request error, or an empty
// result) it returns null so runCodegraphQuery transparently falls back to the
// heuristic index. This is the .ts seam that talks to the LSP manager; the pure
// mapping/formatting lives in the unit-tested lspSymbols.mjs leaf, and the
// CodeGraph core (workspace.mjs) stays dependency-injected and LSP-free.

import { open } from 'fs/promises'
import { pathToFileURL } from 'url'
import {
  getLspServerManager,
  isLspConnected,
} from '../../services/lsp/manager.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { toError } from '../errors.js'
import {
  mapDocumentSymbolsToLines,
  mapWorkspaceSymbolsToLines,
} from './lspSymbols.mjs'
import { resolveInsideCwd } from './workspace.mjs'

const MAX_LSP_FILE_SIZE_BYTES = 10_000_000

export type LspCodegraphResult = { lines: string[]; note?: string }

/** list_symbols → textDocument/documentSymbol on the file's language server. */
async function lspListSymbols(
  file: string,
  signal?: { aborted?: boolean },
): Promise<LspCodegraphResult | null> {
  if (signal?.aborted) return null
  if (!isLspConnected()) return null
  const manager = getLspServerManager()
  if (!manager) return null
  const abs = resolveInsideCwd(getCwd(), file)
  if (!abs) return null
  try {
    if (!manager.isFileOpen(abs)) {
      const handle = await open(abs, 'r')
      try {
        const stats = await handle.stat()
        if (!stats.isFile() || stats.size > MAX_LSP_FILE_SIZE_BYTES) return null
        const content = await handle.readFile({ encoding: 'utf-8' })
        await manager.openFile(abs, content)
      } finally {
        await handle.close()
      }
    }
    const result = await manager.sendRequest(abs, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(abs).toString() },
    })
    // undefined ⇒ no server for this file type → fall back to the heuristic.
    if (result == null) return null
    const { lines } = mapDocumentSymbolsToLines(result)
    if (lines.length === 0) return null
    return { lines, note: 'Resolved via LSP (authoritative).' }
  } catch (e) {
    logForDebugging(`[codegraph→lsp] documentSymbol failed for ${file}: ${toError(e).message}`)
    return null
  }
}

/** find_definition → workspace/symbol fanned out across every healthy server. */
async function lspFindDefinition(
  name: string,
  signal?: { aborted?: boolean },
): Promise<LspCodegraphResult | null> {
  if (signal?.aborted) return null
  if (!isLspConnected()) return null
  const manager = getLspServerManager()
  if (!manager) return null
  // Fan out in PARALLEL — under concurrency-safe=true many queries run at once, so
  // serial awaits would stack each server's per-request timeout. allSettled also
  // isolates a single server's failure from the others (and the heuristic fallback).
  const servers = [...manager.getAllServers().values()].filter(s => s.isHealthy())
  const settled = await Promise.allSettled(
    servers.map(s => s.sendRequest('workspace/symbol', { query: name })),
  )
  const collected: unknown[] = []
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.status === 'fulfilled') {
      if (Array.isArray(r.value)) collected.push(...r.value)
    } else {
      logForDebugging(`[codegraph→lsp] workspace/symbol failed on ${servers[i].name}: ${toError(r.reason).message}`)
    }
  }
  // Exact (case-insensitive) name match preserves find_definition's by-name
  // contract. An empty result returns null so the caller uses the heuristic; a
  // non-empty result is MERGED with the heuristic by the caller (LSP coverage can
  // be partial), so we do not claim the heuristic is suppressed here.
  const { lines } = mapWorkspaceSymbolsToLines(collected, getCwd(), { nameFilter: name })
  if (lines.length === 0) return null
  return { lines, note: 'Resolved via LSP (authoritative).' }
}

/**
 * The resolver passed to runCodegraphQuery. Its methods self-check LSP
 * availability per call, so it is always safe to pass (they no-op to null when
 * LSP is off or the connection drops mid-session).
 */
export function createLspCodegraphResolver(): {
  listSymbols: (file: string, signal?: { aborted?: boolean }) => Promise<LspCodegraphResult | null>
  findDefinition: (name: string, signal?: { aborted?: boolean }) => Promise<LspCodegraphResult | null>
} {
  return { listSymbols: lspListSymbols, findDefinition: lspFindDefinition }
}
