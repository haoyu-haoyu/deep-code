// NotebookEditTool edits a notebook against the view captured by the last Read
// (readFileState), exactly like FileEditTool edits a text file against its read
// view. FileEditTool already guards its staleness check with a content-equality
// fallback: when the file's mtime is newer than the read but the content is
// byte-identical, it proceeds anyway — because a bare mtime bump (cloud sync,
// antivirus, a no-op formatter, an editor touch — common on Windows/OneDrive)
// is a FALSE positive that would otherwise force a needless re-read.
//
// NotebookEditTool lacked that fallback and rejected on mtime alone, so a
// touched-but-unchanged notebook spuriously failed with "File has been modified
// since read". This leaf is the pure decision the .ts wiring uses to mirror
// FileEditTool's guard.
//
// `readState.content` for a notebook is the processed cells JSON
// (jsonStringify(readNotebook(path)) — see FileReadTool), so the caller
// re-derives `currentCellsJson` the same way and passes it here. The comparison
// is content-based and therefore robust to path-form differences (the cells JSON
// embeds no path).
//
// Only a FULL read (no offset/limit) is trusted for the content equality, matching
// FileEditTool: a partial/ranged read's stored content is not the whole file, so
// byte-equality there cannot prove the rest of the notebook is unchanged.
export function notebookUnchangedDespiteMtime(currentCellsJson, readState) {
  if (!readState) {
    return false
  }
  const isFullRead = readState.offset === undefined && readState.limit === undefined
  return isFullRead && currentCellsJson === readState.content
}
