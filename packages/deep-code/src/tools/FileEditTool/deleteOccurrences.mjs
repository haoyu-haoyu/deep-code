// Delete occurrences of `oldString` from `content` — the file-edit case where
// new_string is empty. For each REMOVED occurrence, also consume the single
// immediately-following newline when `oldString` is not itself newline-terminated,
// so deleting a line's content doesn't strand an empty line.
//
// This replaces a global `content.replaceAll(oldString + '\n', '')`. Prepending
// one fixed `+ '\n'` to the search string conflated two independent decisions —
// WHICH occurrences to delete vs. whether each occurrence's trailing newline
// should be consumed — and the `stripTrailingNewline` flag was computed ONCE over
// the whole file. So a replace_all delete matched only the occurrences that
// happened to be followed by a newline and silently skipped every occurrence that
// wasn't, leaving content behind while the tool still reported "All occurrences
// were successfully replaced." Scanning occurrence-by-occurrence makes the
// newline-consumption a per-occurrence decision, so every occurrence is removed.
//
// Behavior is identical to the old code on the only shapes the live tool reaches
// without this bug — a single (uniqueness-guarded) edit, and a replace_all over
// occurrences with homogeneous trailing context — and only differs by deleting the
// occurrences the old code skipped.
export function deleteOccurrences(content, oldString, replaceAll) {
  if (oldString === '') return content
  const consumeTrailingNewline = !oldString.endsWith('\n')
  let result = ''
  let cursor = 0
  for (;;) {
    const idx = content.indexOf(oldString, cursor)
    if (idx === -1) break
    result += content.slice(cursor, idx)
    let after = idx + oldString.length
    if (consumeTrailingNewline && content[after] === '\n') after += 1
    cursor = after
    if (!replaceAll) break
  }
  result += content.slice(cursor)
  return result
}
