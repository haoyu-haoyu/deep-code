import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diagnosticSeverityRank } from '../src/services/lsp/diagnosticSeverityRank.mjs'
import { capDiagnosticsByGlobalSeverity } from '../src/services/lsp/capDiagnosticsByGlobalSeverity.mjs'
import { joinDiagnosticBlocksWithinBudget } from '../src/services/diagnosticSummaryBudget.mjs'

const file = (uri, severity, n, extra = {}) => ({
  uri,
  ...extra,
  diagnostics: Array.from({ length: n }, (_, i) => ({ severity, message: `${severity} ${i}` })),
})
const countSev = (files, sev) =>
  files.reduce((n, f) => n + f.diagnostics.filter(d => d.severity === sev).length, 0)

// ---- diagnosticSeverityRank ----

test('severity rank orders Error < Warning < Info < Hint, unknown = Hint', () => {
  assert.ok(diagnosticSeverityRank('Error') < diagnosticSeverityRank('Warning'))
  assert.ok(diagnosticSeverityRank('Warning') < diagnosticSeverityRank('Info'))
  assert.ok(diagnosticSeverityRank('Info') < diagnosticSeverityRank('Hint'))
  assert.equal(diagnosticSeverityRank(undefined), diagnosticSeverityRank('Hint'))
})

// ---- capDiagnosticsByGlobalSeverity (the 30-count cap, D) ----

test('global cap keeps a LATER file ERRORS over EARLIER files WARNINGS (the bug)', () => {
  const files = [
    file('a.ts', 'Warning', 10),
    file('b.ts', 'Warning', 10),
    file('c.ts', 'Warning', 10),
    file('errors.ts', 'Error', 5), // arrives last
  ]
  const { files: out, truncatedCount } = capDiagnosticsByGlobalSeverity(files, 10, 30)
  assert.equal(out.reduce((n, f) => n + f.diagnostics.length, 0), 30)
  const errFile = out.find(f => f.uri === 'errors.ts')
  assert.ok(errFile, 'the error file must survive the cap')
  assert.equal(errFile.diagnostics.length, 5) // ALL 5 errors kept
  assert.equal(countSev(out, 'Error'), 5)
  assert.equal(countSev(out, 'Warning'), 25) // 5 warnings dropped, not the errors
  assert.equal(truncatedCount, 5)
})

test('per-file cap limits a single file', () => {
  const { files: out, truncatedCount } = capDiagnosticsByGlobalSeverity(
    [file('big.ts', 'Error', 15)],
    10,
    30,
  )
  assert.equal(out[0].diagnostics.length, 10)
  assert.equal(truncatedCount, 5)
})

test('a file whose diagnostics all lose the global budget is dropped', () => {
  const { files: out } = capDiagnosticsByGlobalSeverity(
    [file('a.ts', 'Error', 10), file('b.ts', 'Error', 10), file('c.ts', 'Warning', 10)],
    10,
    20, // 20 errors fill the budget; c's warnings all lose
  )
  assert.ok(!out.find(f => f.uri === 'c.ts'))
  assert.equal(out.reduce((n, f) => n + f.diagnostics.length, 0), 20)
  assert.equal(countSev(out, 'Error'), 20)
})

test('does not mutate the input and preserves other file fields', () => {
  const files = [file('a.ts', 'Warning', 3, { serverName: 'ts' })]
  const before = JSON.stringify(files)
  const { files: out } = capDiagnosticsByGlobalSeverity(files, 10, 30)
  assert.equal(JSON.stringify(files), before) // input untouched
  assert.equal(out[0].serverName, 'ts') // extra field preserved
})

test('within-file order is preserved among kept diagnostics', () => {
  const f = {
    uri: 'a.ts',
    diagnostics: [
      { severity: 'Error', message: 'first' },
      { severity: 'Error', message: 'second' },
    ],
  }
  const { files: out } = capDiagnosticsByGlobalSeverity([f], 10, 30)
  assert.deepEqual(out[0].diagnostics.map(d => d.message), ['first', 'second'])
})

// ---- joinDiagnosticBlocksWithinBudget (the 4000-char cap, E) ----

test('renders error-bearing blocks BEFORE warning-only blocks', () => {
  const blocks = [
    { text: 'warn.ts:\n  w', severityRank: 2, count: 1 },
    { text: 'err.ts:\n  e', severityRank: 1, count: 1 },
  ]
  const out = joinDiagnosticBlocksWithinBudget(blocks, 4000)
  assert.ok(out.indexOf('err.ts') < out.indexOf('warn.ts'))
})

test('drops trailing lowest-severity blocks over budget and reports the omitted count', () => {
  const pad = 'x'.repeat(40)
  const blocks = [
    { text: `err.ts:\n  ${pad}`, severityRank: 1, count: 1 },
    { text: `warn.ts:\n  ${pad}`, severityRank: 2, count: 3 },
  ]
  const out = joinDiagnosticBlocksWithinBudget(blocks, 60) // only the first block fits
  assert.ok(out.includes('err.ts'))
  assert.ok(!out.includes('warn.ts')) // the warning file is dropped, not the error file
  assert.ok(out.includes('3 more diagnostics in 1 more file omitted'))
})

test('singular omitted marker', () => {
  const pad = 'x'.repeat(40)
  const blocks = [
    { text: `err.ts:\n  ${pad}`, severityRank: 1, count: 1 },
    { text: `warn.ts:\n  ${pad}`, severityRank: 2, count: 1 },
  ]
  const out = joinDiagnosticBlocksWithinBudget(blocks, 60)
  assert.ok(out.includes('1 more diagnostic in 1 more file omitted'))
})

test('no truncation when under budget — exact join, in severity order', () => {
  const blocks = [
    { text: 'a.ts:\n  e', severityRank: 1, count: 1 },
    { text: 'b.ts:\n  w', severityRank: 2, count: 1 },
  ]
  assert.equal(joinDiagnosticBlocksWithinBudget(blocks, 4000), 'a.ts:\n  e\n\nb.ts:\n  w')
})

test('a single block larger than the whole budget is line-truncated, never cut mid-line', () => {
  const block = {
    text: 'big.ts:\n  err line one\n  err line two\n  warn line three',
    severityRank: 1,
    count: 3,
  }
  let out
  assert.doesNotThrow(() => {
    out = joinDiagnosticBlocksWithinBudget([block], 28)
  })
  assert.ok(out.length <= 28)
  assert.ok(out.includes('…[truncated]'))
  // truncated at a line boundary: the body has no partial diagnostic line
  assert.ok(!out.includes('err line tw'))
})
