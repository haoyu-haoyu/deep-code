import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  schemaClosesAnOpenMap,
  resolveStrictToolNames,
} from '../src/tools/resolveStrictToolNames.mjs'

// A parameter literally NAMED `additionalProperties` / `patternProperties` lives
// as a KEY inside the `properties` map. The open-map detector must not mistake
// that user-chosen name for the JSON-Schema keyword of the same name.

test('a param named additionalProperties/patternProperties is NOT an open map', () => {
  const namedAP = {
    type: 'object',
    properties: {
      additionalProperties: { type: 'boolean' },
      file_path: { type: 'string' },
    },
    required: ['additionalProperties', 'file_path'],
    additionalProperties: false,
  }
  const namedPP = {
    type: 'object',
    properties: {
      patternProperties: { type: 'boolean' },
      x: { type: 'string' },
    },
    required: ['patternProperties', 'x'],
    additionalProperties: false,
  }
  assert.equal(schemaClosesAnOpenMap(namedAP), false)
  assert.equal(schemaClosesAnOpenMap(namedPP), false)
})

test('all strict modes now agree: a strict-safe keyword-named-param tool is selected', () => {
  const tool = {
    name: 'ConfigTool',
    inputJSONSchema: {
      type: 'object',
      properties: {
        additionalProperties: { type: 'boolean' },
        file_path: { type: 'string' },
      },
      required: ['additionalProperties', 'file_path'],
      additionalProperties: false,
    },
  }
  // Previously 'safe' selected it (a true strict no-op) while 'all'/'nullable'
  // silently excluded it — the reverse of intent. Now all three agree.
  for (const mode of ['safe', 'all', 'nullable']) {
    assert.equal(
      resolveStrictToolNames(mode, [tool]).has('ConfigTool'),
      true,
      `${mode} must select the strict-safe tool`,
    )
  }
})

test('a keyword-named param NESTED in a sub-object is also not mistaken', () => {
  const schema = {
    type: 'object',
    properties: {
      cfg: {
        type: 'object',
        properties: { additionalProperties: { type: 'boolean' } },
        required: ['additionalProperties'],
        additionalProperties: false,
      },
    },
    required: ['cfg'],
    additionalProperties: false,
  }
  assert.equal(schemaClosesAnOpenMap(schema), false)
})

test('a $def named after a keyword is not mistaken', () => {
  const schema = {
    type: 'object',
    properties: { x: { $ref: '#/$defs/additionalProperties' } },
    required: ['x'],
    additionalProperties: false,
    $defs: {
      additionalProperties: {
        type: 'object',
        properties: { v: { type: 'string' } },
        required: ['v'],
        additionalProperties: false,
      },
    },
  }
  assert.equal(schemaClosesAnOpenMap(schema), false)
})

test('GENUINE open maps are still detected (no over-narrowing)', () => {
  // top-level additionalProperties:true / a value schema
  assert.equal(schemaClosesAnOpenMap({ type: 'object', additionalProperties: true }), true)
  assert.equal(
    schemaClosesAnOpenMap({ type: 'object', additionalProperties: { type: 'string' } }),
    true,
  )
  // a nested z.record property (open map as a real keyword)
  assert.equal(
    schemaClosesAnOpenMap({
      type: 'object',
      properties: { m: { type: 'object', additionalProperties: { type: 'string' } } },
      required: ['m'],
    }),
    true,
  )
  // patternProperties as a real keyword at a schema node
  assert.equal(
    schemaClosesAnOpenMap({ type: 'object', patternProperties: { '^x': { type: 'string' } } }),
    true,
  )
  // a property-less object (default-open)
  assert.equal(
    schemaClosesAnOpenMap({
      type: 'object',
      properties: { m: { type: 'object' } },
      required: ['m'],
    }),
    true,
  )
})

test('a normal fully-closed schema is not an open map', () => {
  assert.equal(
    schemaClosesAnOpenMap({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    }),
    false,
  )
})
