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
// since read". This leaf is the pure decision the .ts wiring uses to mirror it.
//
// `readState.content` for a notebook is the processed cells JSON
// (jsonStringify(readNotebook(path)) — see FileReadTool), so the caller
// re-derives `currentCellsJson` the same way and passes it here. The comparison
// is content-based and therefore robust to path-form differences (the cells JSON
// embeds no path).
//
// Trust gate — `!isPartialView`, NOT the offset/limit gate FileEditTool uses:
// a notebook Read ALWAYS captures the complete notebook (readNotebook reads every
// cell; the default offset=1/limit are stored but never slice it), so its stored
// content is full-fidelity. The only time the stored content is NOT the whole
// notebook is an injected/partial view — flagged by isPartialView (set for
// memory-file attachments whose content differs from disk, the same flag
// FileWriteTool gates on). FileEditTool's offset===undefined gate exists because a
// ranged TEXT read stores only a slice; that concern does not apply to notebooks,
// and copying it here would make the fallback never engage after a normal Read
// (which stores offset=1) — defeating the common Read→touch→edit case.
export function notebookUnchangedDespiteMtime(currentCellsJson, readState) {
  if (!readState || readState.isPartialView) {
    return false
  }
  return currentCellsJson === readState.content
}
