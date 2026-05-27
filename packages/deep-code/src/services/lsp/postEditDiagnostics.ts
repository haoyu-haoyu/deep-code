import type { Diagnostic } from '../diagnosticTracking.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import { clearDeliveredDiagnosticsForFile } from './LSPDiagnosticRegistry.js'
import { getLspServerManager } from './manager.js'
import { notifyAndCollectDiagnosticsCore } from './postEditDiagnostics-core.mjs'
import { formatDiagnosticsForAttachment } from './passiveFeedback.js'
import {
  applyLspDiagnosticConfig,
  emptyPostEditResult,
  getLspConfig,
} from './defaults.js'

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
  pollDelay,
  maxDiagnostics,
}: {
  filePath: string
  content: string
  operation: 'edit' | 'write'
  pollDelay?: number
  maxDiagnostics?: number
}): Promise<PostEditResult> {
  const lspConfig = getLspConfig()
  if (!lspConfig.enabled) {
    return emptyPostEditResult()
  }

  const effectiveConfig = {
    ...lspConfig,
    poll_after_edit_ms: pollDelay ?? lspConfig.poll_after_edit_ms,
    max_diagnostics_per_file:
      maxDiagnostics ?? lspConfig.max_diagnostics_per_file,
  }

  const result = (await notifyAndCollectDiagnosticsCore({
    filePath,
    content,
    operation,
    pollDelay: effectiveConfig.poll_after_edit_ms,
    maxDiagnostics: Number.MAX_SAFE_INTEGER,
    lspManager: getLspServerManager(),
    clearDeliveredDiagnosticsForFile,
    formatDiagnosticsForAttachment,
    delay: sleep,
    logForDebugging,
    logError,
  })) as PostEditResult

  return applyLspDiagnosticConfig(result, effectiveConfig) as PostEditResult
}
