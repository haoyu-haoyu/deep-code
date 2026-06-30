// Severity priority for diagnostics: LOWER = more severe / higher priority. Mirrors
// the LSP DiagnosticSeverity ordering (Error < Warning < Information < Hint). Shared
// SSOT for every place that must keep ERRORS ahead of lower-severity diagnostics when
// capping or truncating the set the model sees, so a real error is never silently
// dropped in favour of a warning/hint.
//
// @param {string | undefined} severity
// @returns {number}
export function diagnosticSeverityRank(severity) {
  switch (severity) {
    case 'Error':
      return 1
    case 'Warning':
      return 2
    case 'Info':
      return 3
    case 'Hint':
      return 4
    default:
      return 4
  }
}
