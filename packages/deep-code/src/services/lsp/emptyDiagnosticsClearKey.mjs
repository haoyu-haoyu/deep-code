/**
 * Decide whether a publishDiagnostics notification is an authoritative "this file
 * is now clean" signal, and if so return the dedup-cache key to clear.
 *
 * An LSP server publishes an EMPTY diagnostics array for a file to say it no
 * longer has any problems (LSP spec: a later publish fully replaces the prior
 * set). The passive-feedback handler skips registering an empty publish — but it
 * must still clear that file from the cross-turn dedup cache
 * (LSPDiagnosticRegistry.deliveredDiagnostics, keyed by DiagnosticFile.uri =
 * plain absolute path). Otherwise, if the SAME diagnostic later reappears — a
 * re-introduced error, or a file broken by editing a DIFFERENT file (the per-edit
 * clear in postEditDiagnostics only covers the edited file) — dedupe treats it as
 * already-delivered and silently suppresses it from the model.
 *
 * The returned key is firstFile.uri verbatim. That is exactly the form the dedup
 * cache is stored under: both the stored key (registerPendingLSPDiagnostic keys by
 * DiagnosticFile.uri) and this clear key come from the SAME
 * formatDiagnosticsForAttachment output, which normally fileURLToPath-decodes the
 * server's file:// URI to a plain path but falls back to the raw URI if decoding
 * throws. Because both go through that one producer for a given publish, the clear
 * matches the stored entry rather than no-op'ing on a key-form mismatch.
 *
 * @param {Array<{ uri: string, diagnostics: unknown[] }>} diagnosticFiles
 * @returns {string|null} the DiagnosticFile.uri to clear, or null when the publish
 *   carries diagnostics (nothing to clear) or there is no file.
 */
export function emptyDiagnosticsClearKey(diagnosticFiles) {
  const firstFile = diagnosticFiles && diagnosticFiles[0]
  if (!firstFile) return null
  return firstFile.diagnostics.length === 0 ? firstFile.uri : null
}
