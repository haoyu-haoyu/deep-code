/**
 * Group + deduplicate LSP diagnostic files within a batch (and against
 * previously-delivered diagnostics), in O(total diagnostics) rather than
 * O(files * distinct-uris).
 *
 * The previous implementation maintained a `Map<uri, Set<key>>` for the seen
 * keys but ALSO kept the output as a plain array and re-found each file's entry
 * with `dedupedFiles.find(f => f.uri === file.uri)` on every input file — an
 * O(distinct-uris) linear scan per file, so grouping a batch of M file entries
 * spanning N distinct uris was O(M*N). A single `Map<uri, {seen, file}>` makes
 * the per-file lookup O(1); because a Map preserves insertion order, the output
 * (and per-file diagnostic order) is byte-identical to the array+find version.
 *
 * Behaviour is otherwise preserved exactly: a diagnostic is dropped if its key
 * was already seen in this batch OR was previously delivered (per-uri); a
 * `createKey` throw is caught, reported via `onKeyError`, and the diagnostic is
 * kept anyway (to avoid losing information); files with no surviving diagnostics
 * are filtered out.
 *
 * @param {import('../diagnosticTracking.js').DiagnosticFile[]} allFiles
 * @param {object} deps
 * @param {(uri: string) => Set<string>} deps.getPreviouslyDelivered  cross-turn delivered keys for a uri (empty Set if none)
 * @param {(diag: import('../diagnosticTracking.js').Diagnostic) => string} deps.createKey  content key for within-batch + cross-turn dedup (may throw)
 * @param {(uri: string, diag: import('../diagnosticTracking.js').Diagnostic, error: unknown) => void} [deps.onKeyError]  invoked when createKey throws
 * @returns {import('../diagnosticTracking.js').DiagnosticFile[]}
 */
export function dedupeDiagnosticFiles(
  allFiles,
  { getPreviouslyDelivered, createKey, onKeyError },
) {
  /** @type {Map<string, { seen: Set<string>, file: import('../diagnosticTracking.js').DiagnosticFile }>} */
  const byUri = new Map()

  for (const file of allFiles) {
    let entry = byUri.get(file.uri)
    if (!entry) {
      entry = { seen: new Set(), file: { uri: file.uri, diagnostics: [] } }
      byUri.set(file.uri, entry)
    }

    // Previously delivered diagnostics for this file (cross-turn dedup).
    const previouslyDelivered = getPreviouslyDelivered(file.uri)

    for (const diag of file.diagnostics) {
      try {
        const key = createKey(diag)
        // Skip if already seen in this batch OR delivered in a previous turn.
        if (entry.seen.has(key) || previouslyDelivered.has(key)) {
          continue
        }
        entry.seen.add(key)
        entry.file.diagnostics.push(diag)
      } catch (error) {
        if (onKeyError) onKeyError(file.uri, diag, error)
        // Include the diagnostic anyway to avoid losing information.
        entry.file.diagnostics.push(diag)
      }
    }
  }

  // Filter out files with no diagnostics after deduplication (insertion order).
  const result = []
  for (const { file } of byUri.values()) {
    if (file.diagnostics.length > 0) result.push(file)
  }
  return result
}
