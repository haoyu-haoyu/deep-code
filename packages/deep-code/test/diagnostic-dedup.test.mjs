import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectNewDiagnostics } from '../src/services/diagnosticDedup.mjs'

// Diagnostics modeled as simple strings; equality is identity.
const eq = (a, b) => a === b

test('no right doc: filters file:// diagnostics against the baseline', () => {
  const r = selectNewDiagnostics(['A', 'B'], undefined, ['A'], eq)
  assert.deepEqual(r.newDiagnostics, ['B'])
  assert.deepEqual(r.nextBaseline, ['A', 'B'])
})

test('right doc present: filter AND next baseline both come from the right doc', () => {
  const r = selectNewDiagnostics(['X' /* stale on-disk */], ['D'], [], eq)
  assert.deepEqual(r.newDiagnostics, ['D'])
  assert.deepEqual(r.nextBaseline, ['D'], 'baseline is the right doc, not the file:// array')
})

test('an empty right doc is authoritative (clean virtual doc → nothing new, baseline cleared)', () => {
  // An empty right array still wins over the on-disk file array (it is present,
  // just clean) — the on-disk `stale` must NOT leak through.
  const r = selectNewDiagnostics(['stale'], [], ['D'], eq)
  assert.deepEqual(r.newDiagnostics, [])
  assert.deepEqual(r.nextBaseline, [])
})

// --- THE bug: the 3-call oscillation that re-emitted an already-reported
//     diagnostic when the right doc is unchanged then changes again ---

test('an unchanged-then-changed right doc does NOT re-emit an already-reported diagnostic', () => {
  let baseline = []

  // call 1: right=[D] first seen → D is new, baseline := [D]
  let r = selectNewDiagnostics([], ['D'], baseline, eq)
  assert.deepEqual(r.newDiagnostics, ['D'])
  baseline = r.nextBaseline

  // call 2: right unchanged [D], but on-disk file:// is [] (edit unsaved).
  // FIX: baseline must stay [D] (driven from the right doc), NOT be clobbered to [].
  r = selectNewDiagnostics([], ['D'], baseline, eq)
  assert.deepEqual(r.newDiagnostics, [], 'nothing new on the unchanged call')
  baseline = r.nextBaseline
  assert.deepEqual(baseline, ['D'], 'baseline NOT clobbered by the empty file:// array')

  // call 3: right changes to [D, D2] → only D2 is new; D must NOT resurface.
  r = selectNewDiagnostics([], ['D', 'D2'], baseline, eq)
  assert.deepEqual(r.newDiagnostics, ['D2'], 'D is deduped; only D2 is new')
  baseline = r.nextBaseline
  assert.deepEqual(baseline, ['D', 'D2'])
})

test('regression contrast: clobbering the baseline with file:// (the old behavior) DOES re-emit', () => {
  // Demonstrate the old fileToUse-fallback semantics to pin why the fix matters:
  // if call-2 had written the file:// array ([]) as the baseline, call-3 re-emits D.
  let baseline = ['D'] // after call 1
  const clobbered = [] // old code: baseline := file:// diagnostics on unchanged right
  baseline = clobbered
  const r = selectNewDiagnostics([], ['D', 'D2'], baseline, eq)
  assert.deepEqual(r.newDiagnostics, ['D', 'D2'], 'with a clobbered baseline, D wrongly resurfaces')
})
