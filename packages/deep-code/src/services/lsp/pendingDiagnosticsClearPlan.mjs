// When an LSP server publishes an EMPTY diagnostics array for a file, it is the
// authoritative "this file is now clean" signal. The empty-publish handler cleared
// the cross-turn deliveredDiagnostics LRU but NEVER pendingDiagnostics — so a
// diagnostic that was registered but NOT YET delivered (the model hadn't seen it yet)
// survived the file-is-clean signal and was delivered on the next turn, telling the
// model a STALE, already-resolved error is current. This computes which pending
// entries to prune for the now-clean file uri.
//
// Returns { delete: ids[], update: [{id, files}] }: entry ids whose files ALL matched
// the cleared uri (delete the whole entry) and multi-file entries that still have
// other files (rewrite with the matching file removed). Entries with no match are
// untouched. Pure: the caller mutates the registry from the plan.
//
// @param {Iterable<[string, { files: Array<{ uri: string }> }]>} entries  e.g. a Map
// @param {string} fileKey  the DiagnosticFile.uri the server just declared clean
// @returns {{ delete: string[], update: Array<{ id: string, files: Array<{ uri: string }> }> }}
export function pendingDiagnosticsClearPlan(entries, fileKey) {
  const del = []
  const update = []
  for (const [id, entry] of entries) {
    const files = entry?.files ?? []
    const remaining = files.filter(f => f?.uri !== fileKey)
    if (remaining.length === files.length) continue // no file matched — untouched
    if (remaining.length === 0) del.push(id)
    else update.push({ id, files: remaining })
  }
  return { delete: del, update }
}
