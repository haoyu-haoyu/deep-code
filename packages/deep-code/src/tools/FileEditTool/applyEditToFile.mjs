import { deleteOccurrences } from './deleteOccurrences.mjs'

/**
 * Apply a single edit to file content and return the new content (no disk I/O).
 *
 * This is the SOLE producer of post-edit text. The write path (getPatchForEdits),
 * the IDE accept path (useDiffInIDE), and FileEditTool's settings-file validation
 * simulation all route through it, so what gets validated is byte-for-byte what
 * gets written. The settings simulation previously used a bare
 * `content.replace(old, new)`, which diverged here in two ways:
 *
 *  - Empty newString is a DELETION: a dedicated scanner removes every (or, for a
 *    single edit, the first) occurrence and consumes each occurrence's own
 *    trailing newline. A bare `.replace(old, '')` leaves those newlines behind.
 *    (The previous code prepended one global `oldString + '\n'` search, which
 *    matched ONLY occurrences immediately followed by a newline and silently
 *    skipped the rest — so a replace_all delete over mixed trailing context left
 *    occurrences behind while still reporting "All occurrences were replaced".)
 *
 *  - Non-empty replacement uses FUNCTION replacers so `$`-sequences in newString
 *    ($&, $1, $$, $`) are inserted literally rather than interpreted as
 *    String#replace replacement patterns.
 *
 * @param {string} originalContent
 * @param {string} oldString
 * @param {string} newString
 * @param {boolean} [replaceAll=false]
 * @returns {string}
 */
export function applyEditToFile(
  originalContent,
  oldString,
  newString,
  replaceAll = false,
) {
  if (newString === '') {
    return deleteOccurrences(originalContent, oldString, replaceAll)
  }

  return replaceAll
    ? originalContent.replaceAll(oldString, () => newString)
    : originalContent.replace(oldString, () => newString)
}
