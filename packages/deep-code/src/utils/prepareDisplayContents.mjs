import { escapeForDiff } from './escapeForDiff.mjs'
import { applySequentialEdits as defaultApplySequentialEdits } from '../tools/FileEditTool/applySequentialEdits.mjs'

// Build the escaped before/after strings that getPatchForDisplay diffs to render
// the permission-prompt preview of a FileEdit/FileWrite/NotebookEdit.
//
// The preview MUST match the bytes the write actually produces — the fork's
// "review the diff, then approve" model is only sound if the displayed diff is
// the on-disk result. getPatchForDisplay historically applied the edits with a
// bare escaped-space reduce — `p.replace(escapedOld, () => escapedNew)` /
// `p.replaceAll(...)` — which diverges from the on-disk write in three ways the
// write path already fixed (see getPatchForEdits, which abandoned this same
// reduce for applySequentialEdits):
//
//   1. Content-only DELETE (new_string === ''): `p.replace(old, '')` removes only
//      the matched bytes and LEAVES the following newline, so the preview strands
//      a blank line (or, for a mid-line/substring needle, keeps two lines that the
//      write GLUES). The on-disk deleteOccurrences consumes that newline.
//   2. Leading-tab old_string: convertLeadingTabsToSpaces (/^\t+/gm) turns the
//      STANDALONE old_string's leading tab into spaces, but the file's matched tab
//      is mid-line and stays a tab, so the escaped needle is no longer a substring
//      of the prepared file → the reduce no-ops → an EMPTY preview while the raw
//      on-disk write applies the change.
//   3. Empty old_string on a whitespace-only file: `p.replace('', new)` PREPENDS
//      at offset 0 and keeps the original whitespace, while the write REPLACES the
//      whole file.
//
// Fix: apply the edits with the SAME applySequentialEdits the write uses (the SSOT
// that produces the on-disk bytes), then escape + tab-convert the real before/after
// for rendering — exactly mirroring getPatchForEdits. The tab conversion now only
// affects DISPLAY (applied symmetrically to before and after), never the match.
//
// applySequentialEdits THROWS (string not found / no-op / identity / ambiguous)
// where the legacy reduce silently no-ops. On a throw, fall back to the legacy
// escaped-space reduce so the preview is byte-identical to before — on those paths
// the reduce is itself a no-op (or applies the same non-matching edits the write
// would itself reject), so the fallback preserves today's behaviour with no
// regression.
//
// @param {string} fileContents
// @param {ReadonlyArray<{ old_string: string, new_string: string, replace_all?: boolean }>} edits
// @param {(content: string) => string} convertLeadingTabsToSpaces
//        injected (lives in a .ts module the .mjs layer cannot import)
// @param {(content: string, edits: any[]) => string} [applySequentialEdits]
//        injected for testing; defaults to the real on-disk apply SSOT
// @returns {{ prepared: string, preparedNew: string }} escaped before/after to diff
export function prepareDisplayContents(
  fileContents,
  edits,
  convertLeadingTabsToSpaces,
  applySequentialEdits = defaultApplySequentialEdits,
) {
  const prepared = escapeForDiff(convertLeadingTabsToSpaces(fileContents))
  try {
    const updatedRaw = applySequentialEdits(fileContents, edits)
    return {
      prepared,
      preparedNew: escapeForDiff(convertLeadingTabsToSpaces(updatedRaw)),
    }
  } catch {
    return {
      prepared,
      preparedNew: legacyEscapedReduce(prepared, edits, convertLeadingTabsToSpaces),
    }
  }
}

// The exact reduce getPatchForDisplay used before the SSOT reroute, preserved for
// the fallback so a throwing/unmatched edit renders byte-identically to before.
// Function replacers keep `$`-sequences (`$&`, `$1`) literal — though escapeForDiff
// already maps `$` out of the search space, this matches the original verbatim.
function legacyEscapedReduce(prepared, edits, convertLeadingTabsToSpaces) {
  return edits.reduce((p, edit) => {
    const { old_string, new_string } = edit
    const replace_all = 'replace_all' in edit ? edit.replace_all : false
    const escapedOldString = escapeForDiff(convertLeadingTabsToSpaces(old_string))
    const escapedNewString = escapeForDiff(convertLeadingTabsToSpaces(new_string))
    return replace_all
      ? p.replaceAll(escapedOldString, () => escapedNewString)
      : p.replace(escapedOldString, () => escapedNewString)
  }, prepared)
}
