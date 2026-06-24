import { applyEditToFile } from './applyEditToFile.mjs'

/**
 * Apply a list of edits to `fileContents` in order, mirroring how the file-edit
 * tool composes a multi-edit, and return the fully-edited string. Throws the
 * same diagnostic errors as before on an ambiguous / no-op / identity edit.
 *
 * Ambiguity guard: if a later edit's old_string is a substring of a new_string
 * inserted by an EARLIER edit, the later match could land on the just-inserted
 * text instead of the user's intended location, so we reject it.
 *
 * The guard compares the EXACT old_string that will be applied against the prior
 * new_strings. A previous version stripped trailing newlines from old_string
 * before the check (`old_string.replace(/\n+$/, '')`) — but the edit is APPLIED
 * with the full old_string (newlines intact). Checking the shorter, stripped
 * string answered a different question than the one the apply asks: a benign
 * edit whose full old_string (with its trailing newline) matches the ORIGINAL
 * file — not any inserted text — was falsely rejected with
 * "old_string is a substring of a new_string from a previous edit."
 * Example: file "A\nS\n", edits [{A->xSy}, {S\n->Z}] — the stripped "S" is a
 * substring of the earlier insert "xSy", so the old code threw, yet the full
 * "S\n" only matches the original second line, so the edits are unambiguous and
 * should yield "xSy\nZ".
 *
 * Comparing the exact old_string removes those false positives while still
 * catching the real ambiguity: if the full old_string is genuinely a substring
 * of a prior new_string, `includes` still fires (the stripped check could only
 * ever match a SUPERSET, never fewer). So this never lets through an edit the old
 * code would have allowed.
 *
 * @param {string} fileContents
 * @param {ReadonlyArray<{ old_string: string, new_string: string, replace_all?: boolean }>} edits
 * @param {(file: string, oldStr: string, newStr: string, replaceAll?: boolean) => string} [applyEdit]
 *        injected for testing; defaults to the real applyEditToFile leaf
 * @returns {string} the edited file contents
 */
export function applySequentialEdits(fileContents, edits, applyEdit = applyEditToFile) {
  let updatedFile = fileContents
  const appliedNewStrings = []

  for (const edit of edits) {
    // The gate is unchanged from before — skip the ambiguity check when the
    // old_string is empty or made up entirely of trailing newlines (stripping to
    // ''). Only the COMPARISON needle changes: test the EXACT old_string that
    // will be applied, not its newline-stripped copy. That removes the false
    // positives (a benign edit whose full old_string matches the ORIGINAL file
    // was rejected because its stripped form happened to sit inside an earlier
    // insert) while strictly NARROWING the throw set — includes(full) is a subset
    // of includes(stripped), and the gate is identical, so this never throws
    // where the old code did not (whole-newline old_strings keep their old
    // behavior exactly).
    const oldStringForGate = edit.old_string.replace(/\n+$/, '')
    for (const previousNewString of appliedNewStrings) {
      if (oldStringForGate !== '' && previousNewString.includes(edit.old_string)) {
        throw new Error(
          'Cannot edit file: old_string is a substring of a new_string from a previous edit.',
        )
      }
    }

    const previousContent = updatedFile
    updatedFile =
      edit.old_string === ''
        ? edit.new_string
        : applyEdit(updatedFile, edit.old_string, edit.new_string, edit.replace_all)

    // If this edit didn't change anything, the old_string wasn't found.
    if (updatedFile === previousContent) {
      throw new Error('String not found in file. Failed to apply edit.')
    }

    appliedNewStrings.push(edit.new_string)
  }

  if (updatedFile === fileContents) {
    throw new Error(
      'Original and edited file match exactly. Failed to apply edit.',
    )
  }

  return updatedFile
}
