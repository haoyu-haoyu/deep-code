import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summarizeTscOutput, evaluateBudget } from '../scripts/lib/tscSummary.mjs'

const SAMPLE = [
  "src/a.ts(1,2): error TS2307: Cannot find module './x.js'.",
  "src/b.ts(3,4): error TS2307: Cannot find module './y.js'.",
  'src/c.ts(5,6): error TS2339: Property foo does not exist.',
  'Found 3 errors in 3 files.', // summary line, not an error line
  '', // blank
  'src/d.ts(7,8): note TS1234: not an error', // wrong severity word
].join('\n')

test('summarizeTscOutput counts errors and groups by code, most-frequent first', () => {
  const { errorCount, byCode } = summarizeTscOutput(SAMPLE)
  assert.equal(errorCount, 3)
  assert.deepEqual(byCode, { TS2307: 2, TS2339: 1 })
  // most-frequent code first
  assert.equal(Object.keys(byCode)[0], 'TS2307')
})

test('summarizeTscOutput on clean output is zero', () => {
  const { errorCount, byCode } = summarizeTscOutput('No errors.\n')
  assert.equal(errorCount, 0)
  assert.deepEqual(byCode, {})
})

test('only the literal "error TS<digits>:" shape counts (not notes/prose)', () => {
  // "error TSX" (no digits) and "error TS123" (no colon) must not match
  const out = 'x error TSX: nope\ny error TS123 no colon\nz error TS99: yes'
  assert.equal(summarizeTscOutput(out).errorCount, 1)
})

test('evaluateBudget: no budget is informational and always ok', () => {
  assert.deepEqual(evaluateBudget(1642, null), { ok: true, regressed: false, improved: false })
  assert.deepEqual(evaluateBudget(0, undefined), { ok: true, regressed: false, improved: false })
})

test('evaluateBudget: ratchet fails on regression, signals improvement', () => {
  assert.deepEqual(evaluateBudget(1643, 1642), { ok: false, regressed: true, improved: false })
  assert.deepEqual(evaluateBudget(1642, 1642), { ok: true, regressed: false, improved: false })
  assert.deepEqual(evaluateBudget(1600, 1642), { ok: true, regressed: false, improved: true })
})
