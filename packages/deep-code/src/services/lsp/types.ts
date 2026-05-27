export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type LspServerConfig = {
  command: string
  args?: string[]
  extensionToLanguage: Record<string, string>
  transport?: 'stdio' | 'socket'
  env?: Record<string, string>
  initializationOptions?: unknown
  settings?: unknown
  workspaceFolder?: string
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
}

export type ScopedLspServerConfig = LspServerConfig & {
  scope?: 'dynamic' | 'builtin' | 'user'
  source?: string
}

export type ServerCapabilities = Record<string, unknown>

export type InitializeParams = {
  processId?: number | null
  rootPath?: string | null
  rootUri?: string | null
  initializationOptions?: unknown
  capabilities?: Record<string, unknown>
  workspaceFolders?: Array<{ uri: string; name: string }>
  [key: string]: unknown
}

export type InitializeResult = {
  capabilities: ServerCapabilities
  [key: string]: unknown
}

export type PublishDiagnosticsParams = {
  uri: string
  diagnostics: Array<{
    message: string
    severity?: number
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    source?: string
    code?: string | number
  }>
}
