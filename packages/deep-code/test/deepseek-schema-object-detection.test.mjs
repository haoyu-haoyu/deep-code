import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  sanitizeSchemaForDeepSeekStrict,
  sanitizeSchemaForDeepSeekNullable,
} from '../src/tools/deepseek-schema.mjs'

// DeepSeek /beta strict 400s on 'object' inside a `type` array (the file's own
// probe comment + NULLABLE_SCALAR_TYPES). Assert no sanitized node ever emits it.
function assertNoObjectInTypeArray(node) {
  if (Array.isArray(node)) {
    node.forEach(assertNoObjectInTypeArray)
    return
  }
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.type)) {
    assert.ok(
      !node.type.includes('object'),
      `'object' must never sit in a type array: ${JSON.stringify(node.type)}`,
    )
  }
  for (const v of Object.values(node)) assertNoObjectInTypeArray(v)
}

test('#1: a type:[object,null] node collapses to a bare object (no 400 shape)', () => {
  const input = {
    type: ['object', 'null'],
    properties: { a: { type: 'string' } },
    required: ['a'],
  }
  for (const sanitize of [
    sanitizeSchemaForDeepSeekStrict,
    sanitizeSchemaForDeepSeekNullable,
  ]) {
    const out = sanitize(input)
    assert.equal(out.type, 'object')
    assert.equal(out.additionalProperties, false)
    assert.deepEqual(out.required, ['a'])
    assertNoObjectInTypeArray(out)
  }
})

test('#1 nested: an optional nullable-object property keeps null via the anyOf encoding', () => {
  const input = {
    type: 'object',
    properties: {
      obj: {
        type: ['object', 'null'],
        properties: { x: { type: 'string' } },
        required: ['x'],
      },
      keep: { type: 'string' },
    },
    required: ['keep'],
  }
  // strict: the object is collapsed to a bare (non-null) object — no type array.
  const strict = sanitizeSchemaForDeepSeekStrict(input)
  assert.equal(strict.properties.obj.type, 'object')
  assertNoObjectInTypeArray(strict)
  // nullable: `obj` was optional, so makeNullable reinstates null via anyOf — and
  // still never puts 'object' in a type array.
  const nullable = sanitizeSchemaForDeepSeekNullable(input)
  assert.ok(Array.isArray(nullable.properties.obj.anyOf))
  const branches = nullable.properties.obj.anyOf
  assert.ok(branches.some(b => b.type === 'object'))
  assert.ok(branches.some(b => b.type === 'null'))
  assertNoObjectInTypeArray(nullable)
})

test('#5: a non-object type carrying a stray `properties` is NOT forced object-constrained', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: 'string',
    properties: { a: { type: 'string' } },
  })
  assert.equal(out.type, 'string')
  // the contradictory injection is gone: no required, no additionalProperties
  assert.equal('required' in out, false)
  assert.equal('additionalProperties' in out, false)
})

test('#5 variant: a scalar type ARRAY with a stray `properties` is also left unconstrained', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: ['string', 'null'],
    properties: { a: { type: 'string' } },
  })
  assert.deepEqual(out.type, ['string', 'null'])
  assert.equal('required' in out, false)
  assert.equal('additionalProperties' in out, false)
})

test('parity: a normal object schema is byte-identical (required=all sorted, AP:false)', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: { b: { type: 'number' }, a: { type: 'string' } },
    required: ['a'],
  })
  assert.deepEqual(out, {
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a', 'b'],
    type: 'object',
    additionalProperties: false,
  })
})

test('an untyped node with properties is still treated as an object; a bare object closes', () => {
  // untyped + properties → object (unchanged behavior)
  const untyped = sanitizeSchemaForDeepSeekStrict({
    properties: { a: { type: 'string' } },
  })
  assert.equal(untyped.type, 'object')
  assert.equal(untyped.additionalProperties, false)
  // a bare {type:'object'} still closes to required:[] / AP:false (unchanged)
  assert.deepEqual(sanitizeSchemaForDeepSeekStrict({ type: 'object' }), {
    type: 'object',
    required: [],
    additionalProperties: false,
  })
  // a pure scalar / enum / $ref node is untouched (not object-detected)
  assert.deepEqual(sanitizeSchemaForDeepSeekStrict({ type: 'string' }), {
    type: 'string',
  })
})
