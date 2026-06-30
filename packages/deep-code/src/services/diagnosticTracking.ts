import figures from 'figures'
import { logError } from 'src/utils/log.js'
import { callIdeRpc } from '../services/mcp/client.js'
import { selectNewDiagnostics } from './diagnosticDedup.mjs'
import { diagnosticFileLabel } from './diagnosticFileLabel.mjs'
import { joinDiagnosticBlocksWithinBudget } from './diagnosticSummaryBudget.mjs'
import { diagnosticSeverityRank } from './lsp/diagnosticSeverityRank.mjs'
import { getCwd } from '../utils/cwd.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { ClaudeError } from '../utils/errors.js'
import { normalizePathForComparison, pathsEqual } from '../utils/file.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { jsonParse } from '../utils/slowOperations.js'

class DiagnosticsTrackingError extends ClaudeError {}

const MAX_DIAGNOSTICS_SUMMARY_CHARS = 4000

export interface Diagnostic {
  message: string
  severity: 'Error' | 'Warning' | 'Info' | 'Hint'
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export interface DiagnosticFile {
  uri: string
  diagnostics: Diagnostic[]
}

export class DiagnosticTrackingService {
  private static instance: DiagnosticTrackingService | undefined
  private baseline: Map<string, Diagnostic[]> = new Map()

  private initialized = false
  private mcpClient: MCPServerConnection | undefined

  // Track when files were last processed/fetched
  private lastProcessedTimestamps: Map<string, number> = new Map()

  static getInstance(): DiagnosticTrackingService {
    if (!DiagnosticTrackingService.instance) {
      DiagnosticTrackingService.instance = new DiagnosticTrackingService()
    }
    return DiagnosticTrackingService.instance
  }

  initialize(mcpClient: MCPServerConnection) {
    if (this.initialized) {
      return
    }

    // TODO: Do not cache the connected mcpClient since it can change.
    this.mcpClient = mcpClient
    this.initialized = true
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    this.baseline.clear()
    this.lastProcessedTimestamps.clear()
  }

  /**
   * Reset tracking state while keeping the service initialized.
   * This clears all tracked files and diagnostics.
   */
  reset() {
    this.baseline.clear()
    this.lastProcessedTimestamps.clear()
  }

  private normalizeFileUri(fileUri: string): string {
    // Remove our protocol prefixes
    const protocolPrefixes = [
      'file://',
      '_claude_fs_right:',
      '_claude_fs_left:',
    ]

    let normalized = fileUri
    for (const prefix of protocolPrefixes) {
      if (fileUri.startsWith(prefix)) {
        normalized = fileUri.slice(prefix.length)
        break
      }
    }

    // Use shared utility for platform-aware path normalization
    // (handles Windows case-insensitivity and path separators)
    return normalizePathForComparison(normalized)
  }

  /**
   * Ensure a file is opened in the IDE before processing.
   * This is important for language services like diagnostics to work properly.
   */
  async ensureFileOpened(fileUri: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    try {
      // Call the openFile tool to ensure the file is loaded
      await callIdeRpc(
        'openFile',
        {
          filePath: fileUri,
          preview: false,
          startText: '',
          endText: '',
          selectToEndOfLine: false,
          makeFrontmost: false,
        },
        this.mcpClient,
      )
    } catch (error) {
      logError(error as Error)
    }
  }

  /**
   * Capture baseline diagnostics for a specific file before editing.
   * This is called before editing a file to ensure we have a baseline to compare against.
   */
  async beforeFileEdited(filePath: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    const timestamp = Date.now()

    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        { uri: `file://${filePath}` },
        this.mcpClient,
      )
      const diagnosticFile = this.parseDiagnosticResult(result)[0]
      if (diagnosticFile) {
        // Compare normalized paths (handles protocol prefixes and Windows case-insensitivity)
        if (
          !pathsEqual(
            this.normalizeFileUri(filePath),
            this.normalizeFileUri(diagnosticFile.uri),
          )
        ) {
          logError(
            new DiagnosticsTrackingError(
              `Diagnostics file path mismatch: expected ${filePath}, got ${diagnosticFile.uri})`,
            ),
          )
          return
        }

        // Store with normalized path key for consistent lookups on Windows
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, diagnosticFile.diagnostics)
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      } else {
        // No diagnostic file returned, store an empty baseline
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, [])
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      }
    } catch (_error) {
      // Fail silently if IDE doesn't support diagnostics
    }
  }

  /**
   * Get new diagnostics from file://, _claude_fs_right, and _claude_fs_ URIs that aren't in the baseline.
   * Only processes diagnostics for files that have been edited.
   */
  async getNewDiagnostics(): Promise<DiagnosticFile[]> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return []
    }

    // Check if we have any files with diagnostic changes
    let allDiagnosticFiles: DiagnosticFile[] = []
    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        {}, // Empty params fetches all diagnostics
        this.mcpClient,
      )
      allDiagnosticFiles = this.parseDiagnosticResult(result)
    } catch (_error) {
      // If fetching all diagnostics fails, return empty
      return []
    }
    const diagnosticsForFileUrisWithBaselines = allDiagnosticFiles
      .filter(file => this.baseline.has(this.normalizeFileUri(file.uri)))
      .filter(file => file.uri.startsWith('file://'))

    const diagnosticsForClaudeFsRightUrisWithBaselinesMap = new Map<
      string,
      DiagnosticFile
    >()
    allDiagnosticFiles
      .filter(file => this.baseline.has(this.normalizeFileUri(file.uri)))
      .filter(file => file.uri.startsWith('_claude_fs_right:'))
      .forEach(file => {
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.set(
          this.normalizeFileUri(file.uri),
          file,
        )
      })

    const newDiagnosticFiles: DiagnosticFile[] = []

    // Process file:// protocol diagnostics
    for (const file of diagnosticsForFileUrisWithBaselines) {
      const normalizedPath = this.normalizeFileUri(file.uri)
      const baselineDiagnostics = this.baseline.get(normalizedPath) || []

      // Get the _claude_fs_right file if it exists
      const claudeFsRightFile =
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.get(normalizedPath)

      // The unsaved virtual (`_claude_fs_right`) document is authoritative when
      // present; the filter AND the next baseline are driven from the SAME
      // source so an unchanged-right call can't clobber the baseline with the
      // on-disk file:// array and re-surface already-reported diagnostics.
      const { newDiagnostics, nextBaseline } = selectNewDiagnostics(
        file.diagnostics,
        claudeFsRightFile?.diagnostics,
        baselineDiagnostics,
        (a, b) => this.areDiagnosticsEqual(a, b),
      )

      if (newDiagnostics.length > 0) {
        newDiagnosticFiles.push({
          uri: file.uri,
          diagnostics: newDiagnostics,
        })
      }

      // Update baseline with the source we filtered against.
      this.baseline.set(normalizedPath, nextBaseline)
    }

    return newDiagnosticFiles
  }

  private parseDiagnosticResult(result: unknown): DiagnosticFile[] {
    if (Array.isArray(result)) {
      const textBlock = result.find(block => block.type === 'text')
      if (textBlock && 'text' in textBlock) {
        const parsed = jsonParse(textBlock.text)
        return parsed
      }
    }
    return []
  }

  private areDiagnosticsEqual(a: Diagnostic, b: Diagnostic): boolean {
    return (
      a.message === b.message &&
      a.severity === b.severity &&
      a.source === b.source &&
      a.code === b.code &&
      a.range.start.line === b.range.start.line &&
      a.range.start.character === b.range.start.character &&
      a.range.end.line === b.range.end.line &&
      a.range.end.character === b.range.end.character
    )
  }

  /**
   * Handle the start of a new query. This method:
   * - Initializes the diagnostic tracker if not already initialized
   * - Resets the tracker if already initialized (for new query loops)
   * - Automatically finds the IDE client from the provided clients list
   *
   * @param clients Array of MCP clients that may include an IDE client
   * @param shouldQuery Whether a query is actually being made (not just a command)
   */
  async handleQueryStart(clients: MCPServerConnection[]): Promise<void> {
    // Only proceed if we should query and have clients
    if (!this.initialized) {
      // Find the connected IDE client
      const connectedIdeClient = getConnectedIdeClient(clients)

      if (connectedIdeClient) {
        this.initialize(connectedIdeClient)
      }
    } else {
      // Reset diagnostic tracking for new query loops
      this.reset()
    }
  }

  /**
   * Format diagnostics into a human-readable summary string.
   * This is useful for displaying diagnostics in messages or logs.
   *
   * @param files Array of diagnostic files to format
   * @returns Formatted string representation of the diagnostics
   */
  static formatDiagnosticsSummary(files: DiagnosticFile[]): string {
    const cwd = getCwd()
    const blocks = files.map(file => {
      // Severity-sort within the file so errors render first (idempotent with the
      // registry's global cap; also orders the IDE/MCP path, which is not capped).
      const sorted = [...file.diagnostics].sort(
        (a, b) =>
          diagnosticSeverityRank(a.severity) - diagnosticSeverityRank(b.severity),
      )
      // The cwd-relative path (not the bare basename) so the model can tell
      // same-basename files apart; also decodes %20 / Windows paths.
      const filename = diagnosticFileLabel(file.uri, cwd)
      const diagnostics = sorted
        .map(d => {
          const severitySymbol = DiagnosticTrackingService.getSeveritySymbol(
            d.severity,
          )

          return `  ${severitySymbol} [Line ${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}${d.code ? ` [${d.code}]` : ''}${d.source ? ` (${d.source})` : ''}`
        })
        .join('\n')

      return {
        text: `${filename}:\n${diagnostics}`,
        // The block's highest-severity rank (errors render first within the block),
        // so error-bearing files are kept ahead of warning-only files under the budget.
        severityRank: sorted.length
          ? diagnosticSeverityRank(sorted[0]!.severity)
          : 4,
        count: file.diagnostics.length,
      }
    })

    return joinDiagnosticBlocksWithinBudget(blocks, MAX_DIAGNOSTICS_SUMMARY_CHARS)
  }

  /**
   * Get the severity symbol for a diagnostic
   */
  static getSeveritySymbol(severity: Diagnostic['severity']): string {
    return (
      {
        Error: figures.cross,
        Warning: figures.warning,
        Info: figures.info,
        Hint: figures.star,
      }[severity] || figures.bullet
    )
  }
}

export const diagnosticTracker = DiagnosticTrackingService.getInstance()
