import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sanitizeSchemaForDeepSeekNullable } from '../src/tools/deepseek-schema.mjs'

// In nullable mode, required = ALL props, and every ORIGINALLY-optional property
// must be widened to also accept null (so it is never forced to a value). A bare
// `{allOf:[…]}` (zod intersection .optional()) or `{not:…}` was misclassified as
// an empty (z.any) schema by isEmptySchema and left UNWIDENED — so the field was
// forced into required[] with a non-nullable shape.

function hasNullBranch(node) {
  return (
    Array.isArray(node.anyOf) && node.anyOf.some(b => b && b.type === 'null')
  )
}

test('an optional bare allOf is widened to accept null', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      f: { allOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }] },
      keep: { type: 'string' },
    },
    required: ['keep'],
  })
  // f was optional → must be null-widened (anyOf with a null branch wrapping the allOf)
  assert.equal(hasNullBranch(out.properties.f), true)
  assert.ok(out.properties.f.anyOf.some(b => Array.isArray(b.allOf)))
  // both props are still in required (the nullable contract: required=all)
  assert.deepEqual(out.required, ['f', 'keep'])
})

test('an optional bare `not` is widened to accept null', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: { g: { not: { type: 'string' } } },
    required: [],
  })
  assert.equal(hasNullBranch(out.properties.g), true)
  assert.ok(out.properties.g.anyOf.some(b => b && b.not))
})

test('parity: z.any ({}) is still treated as empty and NOT widened (it already accepts null)', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: { a: {} },
    required: [],
  })
  assert.deepEqual(out.properties.a, {})
})

test('parity: a REQUIRED bare allOf is left non-null (only optionals are widened)', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      f: { allOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }] },
    },
    required: ['f'],
  })
  // f is required → no null branch; stays a bare allOf (sanitized within)
  assert.equal(hasNullBranch(out.properties.f), false)
  assert.ok(Array.isArray(out.properties.f.allOf))
})

test('parity: a type-bearing allOf was already widened (unchanged by this fix)', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: { h: { type: 'object', allOf: [{ properties: { a: { type: 'string' } } }] } },
    required: [],
  })
  // {type:'object', allOf:[…]} has `type`, so isEmptySchema was already false →
  // makeNullable's final anyOf+null wrap applied before and still does.
  assert.equal(hasNullBranch(out.properties.h), true)
})
