// Pure, dependency-free formatting for a doctor diagnostic's pattern list — the shared
// "show the first few, note how many more" truncation used by every fortress unenforced-*
// warning detector (detectFortressUnenforcedWriteWarnings / *NetHostWarnings in
// doctorDiagnostic.ts). Extracted to a leaf so the two detectors can't drift in how they
// truncate/count, and so the contract is unit-testable without doctorDiagnostic's heavy
// import graph. Returns the { count, patternList } that the i18n fix-message interpolates.
//
// A list of 0 → { count: 0, patternList: '' }; <= `limit` → just the joined list; more →
// "<first `limit`> (N more)". Defensive: a non-array is treated as empty.
export function summarizeWarningPatterns(patterns, limit = 3) {
  const list = Array.isArray(patterns) ? patterns : []
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 3
  const shown = list.slice(0, cap)
  const remaining = list.length - shown.length
  const patternList = remaining > 0 ? `${shown.join(', ')} (${remaining} more)` : shown.join(', ')
  return { count: list.length, patternList }
}
