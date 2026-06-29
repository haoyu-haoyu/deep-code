import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  sanitizeSchemaForDeepSeekStrict,
  sanitizeSchemaForDeepSeekNullable,
} from '../src/tools/deepseek-schema.mjs'

// const / enum / default / examples are INSTANCE DATA, not subschemas. The
// sanitizer must copy them verbatim — recursing would let the schema-keyword
// special-cases (properties/items/anyOf/$defs) and the object finalizer corrupt a
// data object that merely contains a key named like a schema keyword.

test('an object-valued const containing a `properties` key is copied verbatim', () => {
  const constValue = { kind: 'noop', properties: [] }
  for (const sanitize of [
    sanitizeSchemaForDeepSeekStrict,
    sanitizeSchemaForDeepSeekNullable,
  ]) {
    const out = sanitize({
      type: 'object',
      properties: { action: { const: constValue } },
      required: ['action'],
    })
    // the const value is untouched: properties stays the array [], no injected
    // type/required/additionalProperties on the literal.
    assert.deepEqual(out.properties.action.const, { kind: 'noop', properties: [] })
    assert.equal('type' in out.properties.action.const, false)
    assert.equal('required' in out.properties.action.const, false)
    assert.equal(
      'additionalProperties' in out.properties.action.const,
      false,
    )
  }
})

test('a default value is preserved while the node\'s real schema-position properties is still sanitized', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: {
      settings: {
        type: 'object',
        properties: { name: { type: 'string' } },
        default: { properties: { color: 'red' }, name: 'x' },
      },
    },
    required: ['settings'],
  })
  const settings = out.properties.settings
  // the DATA `default` is verbatim (its `properties` stays the data object)
  assert.deepEqual(settings.default, { properties: { color: 'red' }, name: 'x' })
  // the SCHEMA-position `properties` is still sanitized (the node is a real object)
  assert.deepEqual(settings.properties, { name: { type: 'string' } })
  assert.deepEqual(settings.required, ['name'])
  assert.equal(settings.additionalProperties, false)
})

test('enum / examples of objects with keyword-named keys are copied verbatim', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: {
      m: { enum: [{ properties: 'n/a' }, { items: 1 }] },
      e: { type: 'string', examples: [{ anyOf: 'x' }] },
    },
    required: ['m', 'e'],
  })
  assert.deepEqual(out.properties.m.enum, [{ properties: 'n/a' }, { items: 1 }])
  assert.deepEqual(out.properties.e.examples, [{ anyOf: 'x' }])
})

test('the singular `example` keyword (OpenAPI 3.0) is also copied verbatim', () => {
  const out = sanitizeSchemaForDeepSeekStrict({
    type: 'object',
    properties: { p: { type: 'string', example: { properties: [1] } } },
    required: ['p'],
  })
  assert.deepEqual(out.properties.p.example, { properties: [1] })
})

test('parity: scalar const/enum/default and a normal object schema are unchanged', () => {
  assert.deepEqual(sanitizeSchemaForDeepSeekStrict({ type: 'string', enum: ['a', 'b'] }), {
    enum: ['a', 'b'],
    type: 'string',
  })
  assert.deepEqual(
    sanitizeSchemaForDeepSeekStrict({ type: 'string', const: 'x', default: 'a' }),
    { const: 'x', default: 'a', type: 'string' },
  )
  assert.deepEqual(
    sanitizeSchemaForDeepSeekStrict({
      type: 'object',
      properties: { b: { type: 'number' }, a: { type: 'string' } },
      required: ['a'],
    }),
    {
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
      type: 'object',
      additionalProperties: false,
    },
  )
})
