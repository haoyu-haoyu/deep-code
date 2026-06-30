import { diagnosticSeverityRank } from './diagnosticSeverityRank.mjs'

// Cap a set of diagnostic files to a per-file and a GLOBAL budget while NEVER dropping
// a higher-severity diagnostic in favour of a lower-severity one in another file.
//
// The previous loop sorted each file by severity individually but then consumed the
// global MAX_TOTAL budget in file-ARRIVAL order, so once earlier files (often only
// Warnings/Hints) filled the budget, a later file's real ERRORS were sliced to nothing
// and the whole file was dropped — hiding errors from the model. This instead selects
// globally by severity: every Error across all files is kept before any Warning, every
// Warning before any Info, etc., up to maxTotal.
//
// Per-file order and file order are preserved; each file is first severity-sorted and
// capped to maxPerFile (so no single file can monopolise the global budget). Returns
// NEW file objects (input not mutated) preserving each file's other fields, plus the
// total number of diagnostics dropped.
//
// @param {Array<{ uri: string, diagnostics: Array<{ severity?: string }> }>} files
// @param {number} maxPerFile
// @param {number} maxTotal
// @returns {{ files: Array<{ uri: string, diagnostics: Array<object> }>, truncatedCount: number }}
export function capDiagnosticsByGlobalSeverity(files, maxPerFile, maxTotal) {
  const originalTotal = files.reduce((n, f) => n + f.diagnostics.length, 0)

  // 1) Per file: severity-sort (stable) then cap to maxPerFile.
  const perFile = files.map(file => ({
    original: file,
    diagnostics: stableSortBySeverity(file.diagnostics).slice(0, maxPerFile),
  }))

  // 2) Global selection by severity. Flatten with (fileIndex, withinIndex) so the
  // regroup preserves each file's order; stable-sort by severity; keep maxTotal.
  const flat = []
  perFile.forEach((file, fileIndex) => {
    file.diagnostics.forEach((diag, withinIndex) => {
      flat.push({ fileIndex, withinIndex, diag })
    })
  })
  flat.sort(
    (a, b) =>
      diagnosticSeverityRank(a.diag.severity) -
        diagnosticSeverityRank(b.diag.severity) ||
      a.fileIndex - b.fileIndex ||
      a.withinIndex - b.withinIndex,
  )
  const kept = new Set(
    flat.slice(0, Math.max(0, maxTotal)).map(e => `${e.fileIndex}:${e.withinIndex}`),
  )

  // 3) Regroup: keep selected diagnostics in each file's original within-file order;
  // preserve original file order + the original file's other fields; drop empty files.
  const out = []
  perFile.forEach((file, fileIndex) => {
    const diagnostics = file.diagnostics.filter((_, withinIndex) =>
      kept.has(`${fileIndex}:${withinIndex}`),
    )
    if (diagnostics.length > 0) out.push({ ...file.original, diagnostics })
  })

  const keptTotal = out.reduce((n, f) => n + f.diagnostics.length, 0)
  return { files: out, truncatedCount: originalTotal - keptTotal }
}

function stableSortBySeverity(diagnostics) {
  return diagnostics
    .map((diag, i) => ({ diag, i }))
    .sort(
      (a, b) =>
        diagnosticSeverityRank(a.diag.severity) -
          diagnosticSeverityRank(b.diag.severity) || a.i - b.i,
    )
    .map(e => e.diag)
}
