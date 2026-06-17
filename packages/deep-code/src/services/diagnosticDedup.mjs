// Pick the authoritative diagnostics for a file and compute what's NEW versus
// the baseline (the per-file dedup memory), returning the next baseline too.
//
// An IDE diff tab exposes two URIs for the same path: the on-disk `file://`
// document and the unsaved virtual `_claude_fs_right:` document, which can carry
// DIFFERENT diagnostics mid-edit. The previous code only switched to the right
// (virtual) document when its diagnostics had just CHANGED, otherwise it fell
// back to the on-disk `file://` array — and then wrote THAT back as the new
// baseline. So an unchanged-right call clobbered the baseline with the on-disk
// diagnostics, discarding the record that the right-file diagnostics were
// already reported; the next right-file change then re-emitted an
// already-reported diagnostic as "new" (surfaced to the model as a
// <new-diagnostics> reminder).
//
// Fix: when the right (virtual) document exists it is authoritative — drive BOTH
// the new-vs-baseline filter AND the next baseline from the SAME source, so the
// two can never disagree across calls.
//
/**
 * @template D
 * @param {D[]} fileDiagnostics on-disk `file://` diagnostics
 * @param {D[] | undefined} rightDiagnostics `_claude_fs_right:` diagnostics, if present
 * @param {D[]} baseline previously-reported diagnostics for this path
 * @param {(a: D, b: D) => boolean} areEqual diagnostic equality
 * @returns {{ newDiagnostics: D[], nextBaseline: D[] }}
 */
export function selectNewDiagnostics(
  fileDiagnostics,
  rightDiagnostics,
  baseline,
  areEqual,
) {
  // Fall back to file:// only when there is no right doc at all. (`??` over `||`
  // is the intent here — "absent", not "falsy"; equivalent for this Array|undefined
  // type since an empty array is truthy, but `??` states the meaning.) An EMPTY
  // right array is still authoritative: a clean virtual doc → nothing is new.
  const source = rightDiagnostics ?? fileDiagnostics
  const newDiagnostics = source.filter(
    d => !baseline.some(b => areEqual(d, b)),
  )
  return { newDiagnostics, nextBaseline: source }
}
