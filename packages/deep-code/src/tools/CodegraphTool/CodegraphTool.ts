import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { ripGrep } from '../../utils/ripgrep.js'
import { runCodegraphQuery } from '../../utils/codegraph/workspace.mjs'

export const CODEGRAPH_TOOL_NAME = 'CodeGraph'

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
  // Thin adapter: the path sandboxing, index building, and query dispatch live in
  // the pure, unit-tested core (utils/codegraph/workspace.mjs). Here we only
  // inject the real file lister (ripGrep) and the current workspace root.
  async call(input, { abortController }) {
    const data = await runCodegraphQuery({
      input,
      cwd: getCwd(),
      signal: abortController.signal,
      listFiles: ripGrep,
    })
    return { data }
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
