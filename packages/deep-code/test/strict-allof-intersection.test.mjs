import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  schemaClosesAnOpenMap,
  resolveStrictToolNames,
} from '../src/tools/resolveStrictToolNames.mjs'

// An `allOf` (intersection) of two or more OBJECT branches is unsatisfiable under
// /beta strict: the sanitizer forces additionalProperties:false onto every branch,
// so each branch then rejects the others' declared keys. Such a tool must be
// EXCLUDED from strict selection (fall back to non-strict) rather than have the
// fork actively close its branches into an unsatisfiable schema.

const objA = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
const objB = { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] }

test('a multi-object-branch allOf closes an open map (is excluded)', () => {
  assert.equal(schemaClosesAnOpenMap({ allOf: [objA, objB] }), true)
  // OPEN branches (the satisfiable MCP intersection) are also flagged — the fork
  // would otherwise actively close them into an unsatisfiable schema.
  assert.equal(
    schemaClosesAnOpenMap({
      allOf: [{ type: 'object', properties: { a: {} } }, { type: 'object', properties: { b: {} } }],
    }),
    true,
  )
  // untyped-but-property-bearing branches are object branches too
  assert.equal(
    schemaClosesAnOpenMap({ allOf: [{ properties: { a: {} } }, { properties: { b: {} } }] }),
    true,
  )
  // nested inside a property value is still detected
  assert.equal(
    schemaClosesAnOpenMap({
      type: 'object',
      properties: { merged: { allOf: [objA, objB] } },
      required: ['merged'],
    }),
    true,
  )
})

test('an intersection-param tool is excluded from strict under all/nullable', () => {
  const tool = {
    name: 'IntersectionTool',
    inputJSONSchema: {
      type: 'object',
      properties: { merged: { allOf: [objA, objB] } },
      required: ['merged'],
    },
  }
  for (const mode of ['all', 'nullable']) {
    assert.equal(
      resolveStrictToolNames(mode, [tool]).has('IntersectionTool'),
      false,
      `${mode} must exclude the intersection tool (falls back to non-strict)`,
    )
  }
})

test('a single-branch allOf or a non-object allOf stays selectable', () => {
  // single object branch → satisfiable under strict, not excluded
  assert.equal(schemaClosesAnOpenMap({ allOf: [objA] }), false)
  // scalar/constraint-only branches → strict never closes them
  assert.equal(schemaClosesAnOpenMap({ allOf: [{ minLength: 5 }, { maxLength: 10 }] }), false)
  // a string branch + a constraint branch (≤1 object branch)
  assert.equal(schemaClosesAnOpenMap({ allOf: [{ type: 'string' }, { minLength: 5 }] }), false)
})

test('normal schemas and genuine open maps are unchanged', () => {
  // a normal fully-closed object is still not an open map
  assert.equal(
    schemaClosesAnOpenMap({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    }),
    false,
  )
  // a genuine open map is still detected
  assert.equal(schemaClosesAnOpenMap({ type: 'object', additionalProperties: true }), true)
})
