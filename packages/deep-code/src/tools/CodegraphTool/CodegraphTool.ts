import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { ripGrep } from '../../utils/ripgrep.js'
import { buildIndex } from '../../utils/codegraph/indexer.mjs'
import { languageForPath } from '../../utils/codegraph/languages.mjs'
import {
  findDefinition,
  importGraph,
  importersOf,
  listSymbols,
} from '../../utils/codegraph/query.mjs'

export const CODEGRAPH_TOOL_NAME = 'CodeGraph'

// Cap the index so the on-demand build stays bounded on huge repos. The
// indexer additionally skips files larger than its own maxFileBytes.
const MAX_FILES = 20_000

const DESCRIPTION = `Navigate the codebase's structure without reading whole files. A fast, dependency-free heuristic index of JS/TS and Python source. Queries:
- list_symbols: declarations in a file (functions, classes, methods, const/let/var, TS interface/type/enum, Python def/class) with kind + line. Requires "file".
- find_definition: candidate declaration sites for a symbol name, ranked best-first. Requires "name". Returns CANDIDATES (heuristic — no scope/binding resolution), so verify before relying on a single hit.
- import_graph: the modules a file imports. Optional "file" (omit for the whole workspace).
- importers: files that import a given module specifier. Requires "module".

This is a heuristic index (no real parser): use it to locate code quickly, then confirm with Read/Grep. It does not resolve call graphs or shadowing.`

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z
      .enum(['list_symbols', 'find_definition', 'import_graph', 'importers'])
      .describe('Which codegraph query to run'),
    file: z
      .string()
      .optional()
      .describe('Workspace-relative file path (for list_symbols; optional for import_graph)'),
    name: z
      .string()
      .optional()
      .describe('Symbol name to locate (for find_definition)'),
    module: z
      .string()
      .optional()
      .describe('Module specifier to find importers of (for importers)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string(),
    count: z.number(),
    lines: z.array(z.string()),
    note: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type CodegraphOutput = z.infer<OutputSchema>

// Resolve a candidate path against cwd and reject anything that escapes the
// workspace (absolute paths or `../` traversal) — the codegraph only ever reads
// inside the project.
function resolveInsideCwd(cwd: string, rel: string): string | null {
  const abs = resolve(cwd, rel)
  const r = relative(cwd, abs)
  if (r === '' || r.startsWith('..') || /^([A-Za-z]:)?[\\/]/.test(r)) return null
  return abs
}

async function readWorkspaceFile(
  cwd: string,
  rel: string,
  signal: AbortSignal,
): Promise<string | null> {
  const abs = resolveInsideCwd(cwd, rel)
  if (!abs) return null
  try {
    // Thread abort so a long index can be cancelled mid-read.
    return await readFile(abs, { encoding: 'utf8', signal })
  } catch {
    return null
  }
}

async function indexWorkspace(cwd: string, signal: AbortSignal) {
  let files: string[] = []
  let listError = false
  try {
    files = (await ripGrep(['--files'], cwd, signal)).filter(f =>
      languageForPath(f),
    )
  } catch (e) {
    // A genuine cancellation must propagate; only a real rg failure degrades.
    if (signal.aborted) throw e
    listError = true
  }
  if (files.length > MAX_FILES) files = files.slice(0, MAX_FILES)
  const index = await buildIndex({
    files,
    readFile: rel => readWorkspaceFile(cwd, rel, signal),
  })
  return { index, listError }
}

// Build a one-file index after validating the user-supplied path is inside the
// workspace AND a regular file (rejects traversal and FIFO/device targets).
async function indexSingleFile(cwd: string, file: string, signal: AbortSignal) {
  const abs = resolveInsideCwd(cwd, file)
  if (!abs) return { index: null, error: `"${file}" is outside the workspace.` }
  try {
    if (!(await stat(abs)).isFile()) {
      return { index: null, error: `"${file}" is not a regular file.` }
    }
  } catch {
    return { index: null, error: `"${file}" was not found.` }
  }
  const index = await buildIndex({
    files: [file],
    readFile: rel => readWorkspaceFile(cwd, rel, signal),
  })
  return { index, error: undefined as string | undefined }
}

export const CodegraphTool = buildTool({
  name: CODEGRAPH_TOOL_NAME,
  searchHint: 'navigate code structure: symbols, definitions, imports',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  // Dark-launched: opt-in via ENABLE_CODEGRAPH_TOOL (mirrors ENABLE_LSP_TOOL).
  isEnabled() {
    return isEnvTruthy(process.env.ENABLE_CODEGRAPH_TOOL)
  },
  // Each call rebuilds the workspace index (no shared cache yet), so a parallel
  // fan-out would multiply full-repo I/O — run codegraph queries sequentially.
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return [input.query, input.name, input.file, input.module]
      .filter(Boolean)
      .join(' ')
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: true }
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  async call(input, { abortController }) {
    const cwd = getCwd()
    const signal = abortController.signal
    const lines: string[] = []
    let note: string | undefined

    const noResult = (n: string) => ({ data: { query: input.query, count: 0, lines: [], note: n } })

    if (input.query === 'list_symbols') {
      if (!input.file) return noResult('list_symbols requires "file".')
      const single = await indexSingleFile(cwd, input.file, signal)
      if (single.error) return noResult(single.error)
      for (const s of listSymbols(single.index, input.file)) {
        lines.push(`${s.line}\t${s.kind}\t${s.exported ? 'export ' : ''}${s.name}${s.scope ? `  (in ${s.scope})` : ''}`)
      }
      note = lines.length === 0 ? 'No symbols found (unsupported language or empty file).' : undefined
    } else if (input.query === 'find_definition') {
      if (!input.name) return noResult('find_definition requires "name".')
      const { index, listError } = await indexWorkspace(cwd, signal)
      const hits = findDefinition(index, input.name)
      for (const h of hits) {
        lines.push(`${h.file}:${h.line}\t${h.name}\t(${h.why}; confidence ${h.confidence})`)
      }
      note = listError
        ? 'Could not list workspace files (ripgrep failed) — results may be incomplete.'
        : hits.length === 0
          ? `No candidates for "${input.name}".`
          : 'Heuristic candidates — verify with Read before relying on a single hit.'
    } else if (input.query === 'import_graph') {
      let listError = false
      let index
      if (input.file) {
        const single = await indexSingleFile(cwd, input.file, signal)
        if (single.error) return noResult(single.error)
        index = single.index
      } else {
        ;({ index, listError } = await indexWorkspace(cwd, signal))
      }
      const graph = importGraph(index, input.file ? { file: input.file } : {})
      for (const [file, modules] of Object.entries(graph)) {
        lines.push(`${file} → ${modules.join(', ')}`)
      }
      note = listError
        ? 'Could not list workspace files (ripgrep failed) — results may be incomplete.'
        : lines.length === 0
          ? 'No imports found.'
          : undefined
    } else {
      // importers
      if (!input.module) return noResult('importers requires "module".')
      const { index, listError } = await indexWorkspace(cwd, signal)
      for (const { file, modules } of importersOf(index, input.module)) {
        lines.push(`${file}\t(${modules.join(', ')})`)
      }
      note = listError
        ? 'Could not list workspace files (ripgrep failed) — results may be incomplete.'
        : lines.length === 0
          ? `No files import "${input.module}".`
          : undefined
    }

    return { data: { query: input.query, count: lines.length, lines, note } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const body = output.lines.length > 0 ? output.lines.join('\n') : ''
    const content = [body, output.note ? `(${output.note})` : '']
      .filter(Boolean)
      .join('\n\n')
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content || 'No results.',
    }
  },
  renderToolUseMessage(input) {
    const detail = [input.name, input.file, input.module].filter(Boolean).join(' ')
    return `CodeGraph ${input.query}${detail ? ` ${detail}` : ''}`
  },
} satisfies ToolDef<InputSchema, CodegraphOutput>)
