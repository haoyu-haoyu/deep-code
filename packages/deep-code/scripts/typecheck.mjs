#!/usr/bin/env node
// TypeScript type-check gate. Runs `tsc -p tsconfig.json --noEmit` and reports
// the error count + a per-code breakdown. The repo had NO tsconfig and was never
// type-checked (esbuild/bun strip types without checking), so there is a large
// pre-existing baseline (see TYPECHECK.md). This script is:
//   - informational by default (always exits 0) — used as a non-blocking CI step
//     and a one-command local/IDE gate, and
//   - a ratchet when given --max-errors=N (exits 1 if the count exceeds N), so it
//     can be flipped to blocking once the baseline is burned down / deps declared.
//
// tsc is resolved from the workspace; if it isn't installed the gate is skipped
// (exit 0) so a non-blocking CI step never breaks on a missing toolchain.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { summarizeTscOutput, evaluateBudget } from './lib/tscSummary.mjs'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const maxArg = process.argv.find(a => a.startsWith('--max-errors='))
const maxErrors = maxArg ? Number(maxArg.slice('--max-errors='.length)) : null

const tscCandidates = [
  join(pkgRoot, 'node_modules/.bin/tsc'),
  join(pkgRoot, '../../node_modules/.bin/tsc'),
]
const tsc = tscCandidates.find(existsSync)
if (!tsc) {
  console.warn('[typecheck] tsc not found in node_modules — skipping (non-blocking).')
  process.exit(0)
}

const res = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit'], {
  cwd: pkgRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
const { errorCount, byCode } = summarizeTscOutput(output)

console.log(`[typecheck] ${errorCount} type error(s).`)
const top = Object.entries(byCode).slice(0, 12)
if (top.length) {
  console.log('[typecheck] top error codes:')
  for (const [code, n] of top) console.log(`  ${String(n).padStart(5)}  ${code}`)
}
if (errorCount > 0 && maxErrors === null) {
  console.log('[typecheck] informational (non-blocking). See TYPECHECK.md for the burn-down plan.')
}

const { ok, regressed, improved } = evaluateBudget(errorCount, maxErrors)
if (regressed) {
  console.error(
    `[typecheck] FAIL: ${errorCount} errors exceeds the budget of ${maxErrors}. ` +
      'A new type error was introduced — fix it (or, intentionally, raise the budget).',
  )
}
if (improved) {
  console.log(
    `[typecheck] error count (${errorCount}) is below the budget (${maxErrors}) — ` +
      'tighten --max-errors / the committed baseline to lock in the win.',
  )
}
process.exit(ok ? 0 : 1)
