import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeSchemaForDeepSeekStrict,
  sanitizeSchemaForDeepSeekNullable,
  normalizeStrictMode,
  toolToDeepSeekFunctionSchema,
} from '../src/tools/deepseek-schema.mjs'
import { resolveStrictToolNames } from '../src/tools/resolveStrictToolNames.mjs'
import {
  deepSeekToolManifestCacheKey,
  clearDeepSeekToolManifestCache,
} from '../src/services/providers/deepseek-tool-manifest-cache.mjs'

// --- normalizeStrictMode (the SSOT render-kind) ------------------------------

test('normalizeStrictMode maps the strict signal to a render kind', () => {
  assert.equal(normalizeStrictMode('nullable'), 'nullable')
  assert.equal(normalizeStrictMode(true), 'strict')
  assert.equal(normalizeStrictMode('safe'), 'strict')
  assert.equal(normalizeStrictMode('all'), 'strict')
  assert.equal(normalizeStrictMode(false), 'off')
  assert.equal(normalizeStrictMode(undefined), 'off')
  assert.equal(normalizeStrictMode('off'), 'off')
  assert.equal(normalizeStrictMode('garbage'), 'off')
})

// --- sanitizeSchemaForDeepSeekNullable ---------------------------------------

test('required props stay non-nullable; optionals are widened; required = all props', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      offset: { type: 'integer' },
      limit: { type: 'number' },
    },
    required: ['file_path'],
  })
  assert.deepEqual(out, {
    additionalProperties: false,
    properties: {
      file_path: { type: 'string' }, // required → unchanged
      limit: { type: ['number', 'null'] }, // optional → widened
      offset: { type: ['integer', 'null'] }, // optional → widened
    },
    required: ['file_path', 'limit', 'offset'], // ALL props, sorted
    type: 'object',
  })
})

test('with NO optionals, nullable output is byte-identical to strict', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
    required: ['a', 'b'],
  }
  assert.deepEqual(
    sanitizeSchemaForDeepSeekNullable(schema),
    sanitizeSchemaForDeepSeekStrict(schema),
  )
})

test('optional enum / const are wrapped in anyOf with null (null NOT added to enum)', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['a', 'b'] },
      tag: { const: 'x' },
    },
    required: [],
  })
  assert.deepEqual(out.properties.mode, {
    anyOf: [{ enum: ['a', 'b'], type: 'string' }, { type: 'null' }],
  })
  assert.deepEqual(out.properties.tag, {
    anyOf: [{ const: 'x' }, { type: 'null' }],
  })
})

test('optional anyOf gains a null branch; an already-null anyOf is left alone', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      u: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      already: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: [],
  })
  assert.deepEqual(out.properties.u, {
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
  })
  assert.deepEqual(out.properties.already, {
    anyOf: [{ type: 'string' }, { type: 'null' }], // idempotent
  })
})

test('an optional nested object is anyOf-wrapped (object cannot ride a type array) AND its inner optionals widen', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      opts: {
        type: 'object',
        properties: { x: { type: 'string' }, y: { type: 'string' } },
        required: ['y'],
      },
    },
    required: [],
  })
  // The optional object itself is nullable via anyOf (NOT type:['object','null'],
  // which /beta strict rejects); its inner optional x is still widened.
  assert.deepEqual(out.properties.opts, {
    anyOf: [
      {
        additionalProperties: false,
        properties: {
          x: { type: ['string', 'null'] }, // inner optional widened
          y: { type: 'string' }, // inner required unchanged
        },
        required: ['x', 'y'],
        type: 'object',
      },
      { type: 'null' },
    ],
  })
})

test('an optional array is anyOf-wrapped (array cannot ride a type array); scalar type-array idempotent', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
      n: { type: ['integer', 'null'] },
    },
    required: [],
  })
  assert.deepEqual(out.properties.tags, {
    anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
  })
  assert.deepEqual(out.properties.n, { type: ['integer', 'null'] }) // idempotent
})

test('re-application is value-idempotent (semantically stable, deepEqual)', () => {
  const schema = {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      offset: { type: 'integer' },
      mode: { type: 'string', enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } },
      opts: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
    },
    required: ['file_path'],
  }
  const once = sanitizeSchemaForDeepSeekNullable(schema)
  const twice = sanitizeSchemaForDeepSeekNullable(once)
  // No double-widen (no null appended twice, no required prop widened); the second
  // pass is deep-equal to the first. (Bytes differ only by root key-order — the
  // sanitizer is applied exactly once on a raw schema, so that never reaches the wire.)
  assert.deepEqual(twice, once)
})

test('a bare $ref and an empty (z.any) optional are left unchanged', () => {
  const out = sanitizeSchemaForDeepSeekNullable({
    type: 'object',
    properties: {
      ref: { $ref: '#/$defs/X' },
      any: {},
    },
    required: [],
    $defs: { X: { type: 'object', properties: { a: { type: 'string' } }, required: [] } },
  })
  assert.deepEqual(out.properties.ref, { $ref: '#/$defs/X' })
  assert.deepEqual(out.properties.any, {})
  // $defs are still recursed (their inner optionals widen).
  assert.deepEqual(out.$defs.X.properties.a, { type: ['string', 'null'] })
})

// --- resolveStrictToolNames: nullable selects all -----------------------------

test("resolveStrictToolNames('nullable') selects every named tool, like 'all'", () => {
  const tools = [
    { name: 'Read', inputJSONSchema: { type: 'object', properties: { p: { type: 'string' } }, required: [] } },
    { name: 'Edit', inputJSONSchema: { type: 'object', properties: {}, required: [] } },
    { function: { name: 'NoBare' } },
  ]
  const all = resolveStrictToolNames('all', tools)
  const nullable = resolveStrictToolNames('nullable', tools)
  assert.deepEqual([...nullable].sort(), [...all].sort())
  assert.ok(nullable.has('Read') && nullable.has('Edit'))
})

// --- cache key distinguishes the render kinds --------------------------------

test('cache key folds the render kind: off/strict/nullable distinct; safe==all', () => {
  const tool = { name: 'Read', inputJSONSchema: { type: 'object', properties: { o: { type: 'integer' } }, required: [] } }
  const off = deepSeekToolManifestCacheKey(tool, undefined)
  const strictAll = deepSeekToolManifestCacheKey(tool, 'all')
  const strictSafe = deepSeekToolManifestCacheKey(tool, 'safe')
  const strictBool = deepSeekToolManifestCacheKey(tool, true)
  const nullable = deepSeekToolManifestCacheKey(tool, 'nullable')
  assert.equal(strictAll, strictSafe, 'safe and all render identically → same key')
  assert.equal(strictAll, strictBool, 'legacy boolean true == all')
  assert.notEqual(off, strictAll)
  assert.notEqual(off, nullable)
  assert.notEqual(strictAll, nullable, 'nullable must not collide with all')
})

// --- end-to-end render via toolToDeepSeekFunctionSchema -----------------------

test('render: nullable mode → strict:true + nullable params; all/off as expected', async () => {
  clearDeepSeekToolManifestCache()
  const tool = {
    name: 'Read',
    description: 'Read a file',
    inputJSONSchema: {
      type: 'object',
      properties: { file_path: { type: 'string' }, offset: { type: 'integer' } },
      required: ['file_path'],
    },
  }
  const nullable = await toolToDeepSeekFunctionSchema(tool, { strict: 'nullable' })
  assert.equal(nullable.function.strict, true)
  assert.deepEqual(nullable.function.parameters.properties.offset, { type: ['integer', 'null'] })
  assert.deepEqual(nullable.function.parameters.required, ['file_path', 'offset'])

  const all = await toolToDeepSeekFunctionSchema(tool, { strict: 'all' })
  assert.equal(all.function.strict, true)
  assert.deepEqual(all.function.parameters.properties.offset, { type: 'integer' }) // forced, not nullable
  const strictBool = await toolToDeepSeekFunctionSchema(tool, { strict: true })
  assert.deepEqual(all, strictBool, 'mode "all" == legacy boolean true (byte-identical strict path)')

  const off = await toolToDeepSeekFunctionSchema(tool, {})
  assert.equal(off.function.strict, undefined)
  assert.deepEqual(off.function.parameters.required, ['file_path']) // untouched
})
