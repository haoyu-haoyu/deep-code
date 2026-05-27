import type { Diagnostic } from '../diagnosticTracking.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import { clearDeliveredDiagnosticsForFile } from './LSPDiagnosticRegistry.js'
import { getLspServerManager } from './manager.js'
import { notifyAndCollectDiagnosticsCore } from './postEditDiagnostics-core.mjs'
import { formatDiagnosticsForAttachment } from './passiveFeedback.js'

export type LspDiagnostic = Diagnostic

export type PostEditResult = {
  diagnostics: LspDiagnostic[]
  elapsed: number
  truncated: boolean
}

export async function notifyAndCollectDiagnostics({
  filePath,
  content,
  operation,
  pollDelay = 500,
  maxDiagnostics = 10,
}: {
  filePath: string
  content: string
  operation: 'edit' | 'write'
  pollDelay?: number
  maxDiagnostics?: number
}): Promise<PostEditResult> {
  return notifyAndCollectDiagnosticsCore({
    filePath,
    content,
    operation,
    pollDelay,
    maxDiagnostics,
    lspManager: getLspServerManager(),
    clearDeliveredDiagnosticsForFile,
    formatDiagnosticsForAttachment,
    delay: sleep,
    logForDebugging,
    logError,
  }) as Promise<PostEditResult>
}
