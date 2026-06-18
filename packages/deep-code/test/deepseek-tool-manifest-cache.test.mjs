import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  cachedToolToDeepSeekFunctionSchema,
  deepSeekToolManifestCacheKey,
  clearDeepSeekToolManifestCache,
} from '../src/services/providers/deepseek-tool-manifest-cache.mjs'

// A tool that counts how many times its (async) prompt was rendered, so we can
// assert the expensive render happens once per cache key.
function makeTool(name, inputJSONSchema, counter) {
  return {
    name,
    inputJSONSchema,
    prompt: async () => {
      if (counter) counter.calls++
      return `description of ${name}`
    },
  }
}

beforeEach(() => clearDeepSeekToolManifestCache())

test('memoizes per (tool, strict): renders once, returns the SAME object on a hit', async () => {
  const counter = { calls: 0 }
  const tool = makeTool('Read', { type: 'object', properties: { a: { type: 'string' } } }, counter)

  const first = await cachedToolToDeepSeekFunctionSchema(tool, { strict: false })
  const second = await cachedToolToDeepSeekFunctionSchema(tool, { strict: false })

  assert.equal(counter.calls, 1, 'prompt rendered exactly once across two calls')
  assert.equal(first, second, 'same cached object instance (byte-identical manifest)')
  assert.equal(first.function.name, 'Read')
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('strict vs non-strict are distinct cache entries (different rendered parameters)', async () => {
  const counter = { calls: 0 }
  const tool = makeTool('Edit', { type: 'object', properties: { p: { type: 'string' } } }, counter)

  const loose = await cachedToolToDeepSeekFunctionSchema(tool, { strict: false })
  const strict = await cachedToolToDeepSeekFunctionSchema(tool, { strict: true })

  assert.equal(counter.calls, 2, 'each strictness rendered once')
  assert.equal(loose.function.strict, undefined)
  assert.equal(strict.function.strict, true)
  // strict mode sanitizes (adds required/additionalProperties:false) → different bytes
  assert.notEqual(JSON.stringify(loose), JSON.stringify(strict))
})

test('PR#25424: same NAME but different inputJSONSchema must NOT collapse to one entry', async () => {
  // StructuredOutput tools all share the name 'StructuredOutput' but carry a
  // per-call schema. Name-only keying served a stale schema; the key must include
  // inputJSONSchema.
  const a = makeTool('StructuredOutput', { type: 'object', properties: { alpha: { type: 'string' } } })
  const b = makeTool('StructuredOutput', { type: 'object', properties: { beta: { type: 'number' } } })

  const ra = await cachedToolToDeepSeekFunctionSchema(a, { strict: false })
  const rb = await cachedToolToDeepSeekFunctionSchema(b, { strict: false })

  assert.deepEqual(Object.keys(ra.function.parameters.properties), ['alpha'])
  assert.deepEqual(Object.keys(rb.function.parameters.properties), ['beta'], 'NOT the stale alpha schema')
})

test('same NAME differing in a NON-inputJSONSchema field (input_schema) also stays distinct', async () => {
  // The renderer reads inputJSONSchema ?? input_schema ?? parameters ??
  // function.parameters — so the key must too, or these collide on a stale schema.
  const a = { name: 'Dup', input_schema: { type: 'object', properties: { alpha: { type: 'string' } } }, prompt: async () => 'a' }
  const b = { name: 'Dup', input_schema: { type: 'object', properties: { beta: { type: 'number' } } }, prompt: async () => 'b' }
  assert.notEqual(deepSeekToolManifestCacheKey(a, false), deepSeekToolManifestCacheKey(b, false))
  const ra = await cachedToolToDeepSeekFunctionSchema(a, { strict: false })
  const rb = await cachedToolToDeepSeekFunctionSchema(b, { strict: false })
  assert.deepEqual(Object.keys(ra.function.parameters.properties), ['alpha'])
  assert.deepEqual(Object.keys(rb.function.parameters.properties), ['beta'], 'NOT the stale alpha schema')
})

test('inputJSONSchema:null falls through to input_schema in BOTH key and render (no collision)', async () => {
  // The old key used `&& tool.inputJSONSchema` (null -> '') while the renderer's ??
  // skips null -> input_schema; the shared toolRawParameters() now aligns them.
  const a = { name: 'N', inputJSONSchema: null, input_schema: { type: 'object', properties: { p: { type: 'string' } } }, prompt: async () => 'a' }
  const b = { name: 'N', inputJSONSchema: null, input_schema: { type: 'object', properties: { q: { type: 'string' } } }, prompt: async () => 'b' }
  assert.notEqual(deepSeekToolManifestCacheKey(a, false), deepSeekToolManifestCacheKey(b, false))
  const ra = await cachedToolToDeepSeekFunctionSchema(a, { strict: false })
  const rb = await cachedToolToDeepSeekFunctionSchema(b, { strict: false })
  assert.deepEqual(Object.keys(ra.function.parameters.properties), ['p'])
  assert.deepEqual(Object.keys(rb.function.parameters.properties), ['q'])
})

test('clearDeepSeekToolManifestCache forces a re-render', async () => {
  const counter = { calls: 0 }
  const tool = makeTool('Grep', { type: 'object' }, counter)
  await cachedToolToDeepSeekFunctionSchema(tool, { strict: false })
  assert.equal(counter.calls, 1)
  clearDeepSeekToolManifestCache()
  await cachedToolToDeepSeekFunctionSchema(tool, { strict: false })
  assert.equal(counter.calls, 2, 'after clear, the schema is rendered again')
})

test('deepSeekToolManifestCacheKey distinguishes name, inputJSONSchema, and strict', () => {
  const t1 = { name: 'X', inputJSONSchema: { a: 1 } }
  const t2 = { name: 'X', inputJSONSchema: { a: 2 } }
  const t3 = { name: 'Y', inputJSONSchema: { a: 1 } }
  assert.notEqual(deepSeekToolManifestCacheKey(t1, false), deepSeekToolManifestCacheKey(t2, false))
  assert.notEqual(deepSeekToolManifestCacheKey(t1, false), deepSeekToolManifestCacheKey(t3, false))
  assert.notEqual(deepSeekToolManifestCacheKey(t1, false), deepSeekToolManifestCacheKey(t1, true))
  // a tool with no inputJSONSchema keys on name + strict only (stable)
  assert.equal(deepSeekToolManifestCacheKey({ name: 'Z' }, false), deepSeekToolManifestCacheKey({ name: 'Z' }, false))
  // tolerates the function-wrapped name shape and bad input
  assert.equal(typeof deepSeekToolManifestCacheKey({ function: { name: 'F' } }, true), 'string')
  assert.equal(typeof deepSeekToolManifestCacheKey(null, false), 'string')
})
