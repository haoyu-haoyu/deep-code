import { spawn } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'
import { createLSPClientCore } from './core.mjs'
import type {
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
} from './types.js'

/**
 * LSP client interface.
 */
export type LSPClient = {
  readonly capabilities: ServerCapabilities | undefined
  readonly isInitialized: boolean
  start: (
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>
      cwd?: string
    },
  ) => Promise<void>
  initialize: (params: InitializeParams) => Promise<InitializeResult>
  sendRequest: <TResult>(method: string, params: unknown) => Promise<TResult>
  sendNotification: (method: string, params: unknown) => Promise<void>
  onNotification: (method: string, handler: (params: unknown) => void) => void
  onRequest: <TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ) => void
  stop: () => Promise<void>
}

/**
 * Create an LSP client wrapper using the local stdio JSON-RPC transport.
 *
 * @param onCrash - Called when the server process exits unexpectedly (any exit
 *   during operation — crash, signal, or clean self-exit — but not during an
 *   intentional stop). Allows the owner to propagate crash state so the server
 *   can be restarted on next use.
 */
export function createLSPClient(
  serverName: string,
  onCrash?: (error: Error) => void,
): LSPClient {
  return createLSPClientCore({
    serverName,
    onCrash,
    spawn,
    subprocessEnv,
    logForDebugging,
    logError,
    errorMessage,
  }) as LSPClient
}
