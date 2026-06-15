// computeEditsFromContents reconstructs FileEdit { old_string, new_string } pairs
// from a structuredPatch via getEditsForPatch. That reconstruction loses
// trailing-newline information: a unified-diff context line can have a different
// final-newline state in old vs new (e.g. old `a\na` → new `c\na\nb`), which the
// hunk simply cannot encode. So a newline-only change reconstructs to a no-op
// (old_string === new_string) and a content+newline change drops the newline —
// either way the IDE-accepted edit fails to apply (a no-op input that then throws
// "String not found in file" in getPatchForEdit).
//
// computeEditsFromContents has the REAL oldContent and newContent, so verify the
// reconstructed edits actually transform old → new under the SAME apply semantics
// the FileEdit tool uses (getPatchForEdits: `old_string === '' ? new_string :
// applyEditToFile(...)`). If they don't, fall back to a single whole-file edit,
// which always round-trips. `applyEdit` is injected (applyEditToFile) to keep this
// a node-testable leaf. editMode is always 'single' (one hunk → one edit, and the
// FileEdit dialog's applyChanges only consumes edits[0]), so a single whole-file
// edit is the natural fallback unit.
export function reconcileEditsToContents(edits, oldContent, newContent, applyEdit) {
  let rebuilt = oldContent
  for (const edit of edits) {
    const before = rebuilt
    rebuilt =
      edit.old_string === ''
        ? edit.new_string
        : applyEdit(rebuilt, edit.old_string, edit.new_string, edit.replace_all)
    // A real change that reconstructed to a no-op (a newline-only edit) collapses
    // old_string === new_string, so the apply leaves the file unchanged.
    if (rebuilt === before && edit.old_string !== edit.new_string) {
      return [wholeFileEdit(oldContent, newContent)]
    }
  }
  if (rebuilt !== newContent) {
    return [wholeFileEdit(oldContent, newContent)]
  }
  return edits
}

function wholeFileEdit(oldContent, newContent) {
  return { old_string: oldContent, new_string: newContent, replace_all: false }
}
