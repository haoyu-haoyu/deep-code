import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pendingDiagnosticsClearPlan } from '../src/services/lsp/pendingDiagnosticsClearPlan.mjs'

const entry = (...uris) => ({ files: uris.map(uri => ({ uri, diagnostics: [{}] })) })

test('a single-file pending entry for the cleared file is deleted (the stale-error fix)', () => {
  const entries = new Map([['id1', entry('/proj/a.ts')]])
  const plan = pendingDiagnosticsClearPlan(entries, '/proj/a.ts')
  assert.deepEqual(plan.delete, ['id1'])
  assert.deepEqual(plan.update, [])
})

test('an unrelated pending entry is left untouched', () => {
  const entries = new Map([['id1', entry('/proj/other.ts')]])
  const plan = pendingDiagnosticsClearPlan(entries, '/proj/a.ts')
  assert.deepEqual(plan.delete, [])
  assert.deepEqual(plan.update, [])
})

test('a multi-file entry has only the cleared file removed (entry kept)', () => {
  const entries = new Map([['id1', entry('/proj/a.ts', '/proj/b.ts')]])
  const plan = pendingDiagnosticsClearPlan(entries, '/proj/a.ts')
  assert.deepEqual(plan.delete, [])
  assert.equal(plan.update.length, 1)
  assert.equal(plan.update[0].id, 'id1')
  assert.deepEqual(plan.update[0].files.map(f => f.uri), ['/proj/b.ts'])
})

test('clears the matching entry across several pending entries, leaving the rest', () => {
  const entries = new Map([
    ['id1', entry('/proj/a.ts')], // delete
    ['id2', entry('/proj/b.ts')], // keep
    ['id3', entry('/proj/a.ts', '/proj/c.ts')], // update -> only c.ts
  ])
  const plan = pendingDiagnosticsClearPlan(entries, '/proj/a.ts')
  assert.deepEqual(plan.delete, ['id1'])
  assert.equal(plan.update.length, 1)
  assert.equal(plan.update[0].id, 'id3')
  assert.deepEqual(plan.update[0].files.map(f => f.uri), ['/proj/c.ts'])
})

test('two pending entries for the same cleared file are both deleted', () => {
  // an error published twice before delivery → two pending entries, both stale once clean
  const entries = new Map([
    ['id1', entry('/proj/a.ts')],
    ['id2', entry('/proj/a.ts')],
  ])
  const plan = pendingDiagnosticsClearPlan(entries, '/proj/a.ts')
  assert.deepEqual(plan.delete.sort(), ['id1', 'id2'])
})

test('empty registry / missing files are handled without throwing', () => {
  assert.deepEqual(pendingDiagnosticsClearPlan(new Map(), '/proj/a.ts'), { delete: [], update: [] })
  const entries = new Map([['id1', {}], ['id2', { files: null }]])
  assert.deepEqual(pendingDiagnosticsClearPlan(entries, '/proj/a.ts'), { delete: [], update: [] })
})
