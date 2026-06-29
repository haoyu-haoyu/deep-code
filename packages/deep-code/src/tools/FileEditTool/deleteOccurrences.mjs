// Delete occurrences of `oldString` from `content` — the file-edit case where
// new_string is empty. For each REMOVED occurrence, also consume the single
// immediately-following newline when `oldString` is CONTENT-ONLY (not itself
// newline-terminated AND not newline-LED), so deleting a line's content doesn't
// strand an empty line.
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
// The trailing-newline consumption applies ONLY to a content-only oldString. When
// oldString itself STARTS with '\n' (a line deleted together with its leading
// newline, e.g. "\n// X"), its trailing newline belongs to the NEXT line, not to a
// stranded blank line — consuming it both over-reaches (gluing the next line onto
// the previous one) AND, for two adjacent identical lines ("…\nX\nX…"), advanced
// the search cursor past the start of the next occurrence so it was MISSED
// entirely (under-deletion + glue), while the tool still reported success. Gating
// the consumption on `!startsWith('\n')` fixes both: "code\n// X\n// X\nmore"
// deleting "\n// X" (replace_all) now yields "code\nmore" (both removed, structure
// preserved) instead of "code// X\nmore" (stranded) or "codemore" (glued).
//
// Behavior is identical to the old code on the only shapes the live tool reaches
// without this bug — a single (uniqueness-guarded) edit, and a replace_all over
// content-only occurrences — and only differs on a newline-LED oldString (where it
// now preserves the next line's leading newline instead of eating it).
export function deleteOccurrences(content, oldString, replaceAll) {
  if (oldString === '') return content
  const consumeTrailingNewline =
    !oldString.endsWith('\n') && !oldString.startsWith('\n')
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
