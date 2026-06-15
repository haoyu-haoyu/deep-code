import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  stableJsonStringify,
  stableJsonStringifySafe,
} from '../src/cache/deepseek-cache.mjs'

// DSH-5a: the structured-output schema hint (queryRuntimeHaiku /
// queryRuntimeWithModelNonStreaming) is appended to the system prompt, which is
// part of the cached request prefix. It previously serialized with an
// insertion-order safe stringify while every other prefix component (tool/skill
// manifests) already uses stableJsonStringify. stableJsonStringifySafe brings the
// hint in line: key-stable canonicalization with the same String(value) fallback.

test('matches stableJsonStringify for ordinary acyclic schemas', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } }
  assert.equal(stableJsonStringifySafe(schema), stableJsonStringify(schema))
})

test('key order is canonical — differently-ordered keys collapse to one byte string', () => {
  const a = {
    type: 'object',
    required: ['name', 'age'],
    properties: { name: { type: 'string' }, age: { type: 'number' } },
  }
  // same schema, every object built with reversed key insertion order
  const b = {
    properties: { age: { type: 'number' }, name: { type: 'string' } },
    required: ['name', 'age'],
    type: 'object',
  }
  assert.equal(stableJsonStringifySafe(a), stableJsonStringifySafe(b))
})

test('array element ORDER is preserved (required/enum/tuple semantics intact)', () => {
  // sorting must NOT reorder array contents — only object keys.
  const withEnum = { enum: ['c', 'a', 'b'] }
  assert.equal(stableJsonStringifySafe(withEnum), '{"enum":["c","a","b"]}')
  const req = { required: ['z', 'a'] }
  assert.equal(stableJsonStringifySafe(req), '{"required":["z","a"]}')
})

test('nested objects are recursively key-sorted', () => {
  const s = { b: { d: 1, c: 2 }, a: { z: 3, y: 4 } }
  assert.equal(
    stableJsonStringifySafe(s),
    '{"a":{"y":4,"z":3},"b":{"c":2,"d":1}}',
  )
})

test('a cyclic value falls back to String(value) without throwing', () => {
  const cyclic = { type: 'object' }
  cyclic.self = cyclic
  let out
  assert.doesNotThrow(() => {
    out = stableJsonStringifySafe(cyclic)
  })
  assert.equal(typeof out, 'string')
  // the plain stableJsonStringify would throw on the cycle; the safe wrapper
  // returns the String() coercion instead (matching the prior safe behavior).
  assert.equal(out, String(cyclic))
})

test('primitives and arrays round-trip like JSON.stringify', () => {
  assert.equal(stableJsonStringifySafe('x'), '"x"')
  assert.equal(stableJsonStringifySafe(42), '42')
  assert.equal(stableJsonStringifySafe(true), 'true')
  assert.equal(stableJsonStringifySafe([3, 1, 2]), '[3,1,2]')
})

test('fuzz: every key permutation of a schema yields the SAME canonical string', () => {
  // Build the same logical schema with randomly-shuffled key insertion order
  // many times; all must collapse to one byte string (the cache-stability invariant).
  const entries = [
    ['type', 'object'],
    ['additionalProperties', false],
    ['required', ['id', 'name', 'tags']],
    ['properties', { id: { type: 'integer' }, name: { type: 'string' }, tags: { type: 'array' } }],
    ['description', 'a record'],
  ]
  let seed = 0x51a3c7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const canonical = stableJsonStringifySafe(Object.fromEntries(entries))
  for (let i = 0; i < 5000; i++) {
    const shuffled = entries.slice()
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1))
      ;[shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]
    }
    assert.equal(stableJsonStringifySafe(Object.fromEntries(shuffled)), canonical)
  }
})
