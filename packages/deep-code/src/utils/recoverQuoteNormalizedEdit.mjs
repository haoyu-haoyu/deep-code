// The edit-approval preview locates the edit window with scanForContext, which
// matches the old_string with a RAW byte indexOf. The on-disk write instead
// resolves the match through findActualString, which normalizes curly <-> straight
// quotes: the model can only emit straight quotes, but a file may contain curly
// ones (or vice versa), so a quote-mismatched old_string STILL applies on disk,
// editing the real (curly) region.
//
// When the raw scan misses but the file was fully scanned (not truncated), the
// preview falls back to diffing the literal straight old_string against itself —
// showing a before-state that is NOT the file's actual (curly) line, plus phantom
// "\ No newline at end of file" markers. Recover the real file substring the write
// will edit so the previewed before-state matches what is on disk and what gets
// written.
//
// findActualString is injected (it lives in a .ts module the .mjs layer cannot
// import). It returns: the SAME string on an exact raw match (which the raw scan
// would already have found — so not this path), null if absent, or the real,
// differently-quoted substring on a normalized match. Only the last is a recovery;
// the other two return null so the caller keeps its raw-inputs fallback.
//
// new_string and replace_all pass through unchanged — identical to what the
// successful-scan path's normalizeEdit produces, since preserveQuoteStyle returns
// new_string verbatim (a documented no-op).
//
// @param {string} fileContent
// @param {{ old_string: string, new_string: string, replace_all?: boolean }} edit
// @param {(file: string, search: string) => (string | null)} findActualString
// @returns {{ old_string: string, new_string: string, replace_all?: boolean } | null}
export function recoverQuoteNormalizedEdit(fileContent, edit, findActualString) {
  if (edit.old_string === '') return null
  const actual = findActualString(fileContent, edit.old_string)
  if (actual === null || actual === edit.old_string) return null
  return { ...edit, old_string: actual }
}
