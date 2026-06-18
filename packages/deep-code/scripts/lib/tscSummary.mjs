// Pure helpers for the typecheck gate (scripts/typecheck.mjs). Kept as a leaf so
// the parsing + budget logic is node-testable without spawning tsc.

const ERROR_LINE = /error TS(\d+):/

/**
 * Summarize raw `tsc --noEmit` stdout: total error count and a count per error
 * code (e.g. { TS2307: 536, ... }), most-frequent first.
 * @param {string} output
 * @returns {{ errorCount: number, byCode: Record<string, number> }}
 */
export function summarizeTscOutput(output) {
  const byCode = {}
  let errorCount = 0
  for (const line of String(output).split('\n')) {
    const m = line.match(ERROR_LINE)
    if (!m) continue
    errorCount++
    const code = `TS${m[1]}`
    byCode[code] = (byCode[code] ?? 0) + 1
  }
  const sorted = Object.fromEntries(
    Object.entries(byCode).sort((a, b) => b[1] - a[1]),
  )
  return { errorCount, byCode: sorted }
}

/**
 * Decide whether the gate passes. With no budget (maxErrors null/undefined) the
 * gate is informational and always passes. With a budget it is a ratchet: it
 * fails only when the error count EXCEEDS the budget, and signals when the count
 * has dropped below it (so the committed baseline can be tightened).
 * @param {number} errorCount
 * @param {number|null|undefined} maxErrors
 * @returns {{ ok: boolean, regressed: boolean, improved: boolean }}
 */
export function evaluateBudget(errorCount, maxErrors) {
  if (maxErrors === null || maxErrors === undefined) {
    return { ok: true, regressed: false, improved: false }
  }
  return {
    ok: errorCount <= maxErrors,
    regressed: errorCount > maxErrors,
    improved: errorCount < maxErrors,
  }
}
