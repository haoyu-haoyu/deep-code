import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function notifyAndCollectDiagnosticsCore({
  filePath,
  content,
  operation,
  pollDelay = 500,
  maxDiagnostics = 10,
  lspManager,
  clearDeliveredDiagnosticsForFile,
  formatDiagnosticsForAttachment,
  delay = defaultDelay,
  logForDebugging = () => {},
  logError = () => {},
}) {
  const started = Date.now()
  const collected = new Map()
  // The diagnostics collector below is registered on the server's
  // session-lifetime client; this call must remove it again, or every
  // Edit/Write permanently leaks a closure that the LSP server's diagnostic
  // pushes keep fanning out to (see core.mjs onNotification).
  let unsubscribe

  try {
    if (!lspManager) {
      return emptyResult(started)
    }

    const absolutePath = path.resolve(filePath)
    const fileUri = pathToFileURL(absolutePath).href
    clearDeliveredDiagnosticsForFile(fileUri)

    const server = await lspManager.ensureServerStarted(filePath)
    if (!server) {
      return emptyResult(started)
    }

    unsubscribe = server.onNotification(
      'textDocument/publishDiagnostics',
      params => {
        try {
          for (const file of formatDiagnosticsForAttachment(params)) {
            if (normalizeUri(file.uri) !== absolutePath) {
              continue
            }
            for (const diagnostic of file.diagnostics) {
              collected.set(diagnosticKey(diagnostic), diagnostic)
            }
          }
        } catch (error) {
          logError(toError(error))
        }
      },
    )

    if (!lspManager.isFileOpen?.(filePath)) {
      await lspManager.openFile(filePath, content)
    }
    await lspManager.changeFile(filePath, content)
    await lspManager.saveFile(filePath)
    await delay(pollDelay)

    const diagnostics = Array.from(collected.values())
    const truncated = diagnostics.length > maxDiagnostics
    return {
      diagnostics: diagnostics.slice(0, maxDiagnostics),
      elapsed: Date.now() - started,
      truncated,
    }
  } catch (error) {
    const err = toError(error)
    logForDebugging(
      `LSP post-${operation} diagnostics skipped for ${filePath}: ${err.message}`,
    )
    logError(err)
    return emptyResult(started)
  } finally {
    // Remove the per-call collector on every exit path — success, error, or
    // the early returns (which leave unsubscribe undefined, so this no-ops).
    unsubscribe?.()
  }
}

function emptyResult(started) {
  return {
    diagnostics: [],
    elapsed: Date.now() - started,
    truncated: false,
  }
}

function normalizeUri(uri) {
  if (uri.startsWith('file://')) {
    return fileURLToPath(uri)
  }
  return path.resolve(uri)
}

function diagnosticKey(diagnostic) {
  return JSON.stringify({
    message: diagnostic.message,
    severity: diagnostic.severity,
    range: diagnostic.range,
    source: diagnostic.source || null,
    code: diagnostic.code || null,
  })
}

function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

function defaultDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
