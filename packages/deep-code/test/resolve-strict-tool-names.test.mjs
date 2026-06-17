import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveStrictToolNames } from '../src/tools/resolveStrictToolNames.mjs'

// Schema helpers.
const closedAllRequired = {
  type: 'object',
  additionalProperties: false,
  properties: { a: { type: 'string' }, b: { type: 'number' } },
  required: ['a', 'b'],
}
const hasOptional = {
  type: 'object',
  additionalProperties: false,
  properties: { a: { type: 'string' }, b: { type: 'number' } },
  required: ['a'], // b is optional
}
const openExtra = {
  type: 'object', // additionalProperties not false
  properties: { a: { type: 'string' } },
  required: ['a'],
}
const tool = (name, schema) => ({ name, parameters: schema })

test("mode 'off' (and junk) selects no tool", () => {
  const tools = [tool('A', closedAllRequired), tool('B', closedAllRequired)]
  assert.equal(resolveStrictToolNames('off', tools).size, 0)
  assert.equal(resolveStrictToolNames(undefined, tools).size, 0)
  assert.equal(resolveStrictToolNames('weird', tools).size, 0)
})

test("mode 'all' selects every named tool", () => {
  const tools = [tool('A', closedAllRequired), tool('B', hasOptional)]
  assert.deepEqual([...resolveStrictToolNames('all', tools)].sort(), ['A', 'B'])
})

test("mode 'safe' selects only already-strict-shaped (all-required + closed) tools", () => {
  const tools = [
    tool('Closed', closedAllRequired),
    tool('Optional', hasOptional),
    tool('Open', openExtra),
  ]
  assert.deepEqual([...resolveStrictToolNames('safe', tools)], ['Closed'])
})

test("'safe' rejects a tool with a nested object that has an optional sub-property", () => {
  const nested = {
    type: 'object',
    additionalProperties: false,
    properties: {
      outer: {
        type: 'object',
        additionalProperties: false,
        properties: { x: { type: 'string' }, y: { type: 'string' } },
        required: ['x'], // y optional at the nested level
      },
    },
    required: ['outer'],
  }
  assert.equal(resolveStrictToolNames('safe', [tool('N', nested)]).size, 0)
  assert.equal(resolveStrictToolNames('all', [tool('N', nested)]).size, 1)
})

test("'safe' rejects a nested object missing additionalProperties:false", () => {
  const nested = {
    type: 'object',
    additionalProperties: false,
    properties: {
      outer: {
        type: 'object', // no additionalProperties:false
        properties: { x: { type: 'string' } },
        required: ['x'],
      },
    },
    required: ['outer'],
  }
  assert.equal(resolveStrictToolNames('safe', [tool('N', nested)]).size, 0)
})

test("'safe' accepts an array item that is itself all-required+closed", () => {
  const arr = {
    type: 'object',
    additionalProperties: false,
    properties: {
      list: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    required: ['list'],
  }
  assert.deepEqual([...resolveStrictToolNames('safe', [tool('Arr', arr)])], ['Arr'])
})

test('reads tool name from .name or .function.name; skips nameless', () => {
  const tools = [
    { function: { name: 'Fn', parameters: closedAllRequired } },
    { parameters: closedAllRequired }, // no name -> skipped
  ]
  assert.deepEqual([...resolveStrictToolNames('all', tools)], ['Fn'])
})

test('does not throw on empty / missing tools', () => {
  assert.equal(resolveStrictToolNames('all', []).size, 0)
  assert.equal(resolveStrictToolNames('all', undefined).size, 0)
  assert.equal(resolveStrictToolNames('safe', [{ name: 'X' }]).size, 0) // no schema -> not no-op-safe
})

// --- the strict sanitizer recurses into EVERY keyword, not just a hand-rolled
//     allow-list; 'safe' must reject any tool the sanitizer would change, or it
//     would force previously-optional args under those keywords ---

test("'safe' rejects an optional prop under `definitions` (draft-07 / MCP $ref target)", () => {
  const t = tool('Defs', {
    type: 'object',
    additionalProperties: false,
    properties: { ref: { type: 'string' } },
    required: ['ref'],
    definitions: {
      D: {
        type: 'object',
        additionalProperties: false,
        properties: { x: { type: 'string' }, y: { type: 'string' } },
        required: ['x'], // y optional INSIDE definitions -> sanitizer force-requires it
      },
    },
  })
  assert.equal(resolveStrictToolNames('safe', [t]).size, 0)
  assert.equal(resolveStrictToolNames('all', [t]).size, 1)
})

test("'safe' rejects an optional prop under `patternProperties`", () => {
  const t = tool('Pat', {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string' } },
    required: ['a'],
    patternProperties: {
      '^x': {
        type: 'object',
        additionalProperties: false,
        properties: { p: { type: 'string' }, q: { type: 'string' } },
        required: ['p'], // q optional
      },
    },
  })
  assert.equal(resolveStrictToolNames('safe', [t]).size, 0)
})

test("'safe' rejects an optional prop under `prefixItems` (tuple validation)", () => {
  const t = tool('Tuple', {
    type: 'object',
    additionalProperties: false,
    properties: {
      pair: {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            additionalProperties: false,
            properties: { m: { type: 'string' }, n: { type: 'string' } },
            required: ['m'], // n optional
          },
        ],
      },
    },
    required: ['pair'],
  })
  assert.equal(resolveStrictToolNames('safe', [t]).size, 0)
})

test("'safe' rejects a strict-shaped tool carrying a stripped constraint (minLength)", () => {
  // The sanitizer DROPS minLength/maxLength/minItems/maxItems, so even an
  // all-required + closed schema carrying one is NOT a true no-op.
  const t = tool('Len', {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string', minLength: 3 } },
    required: ['a'],
  })
  assert.equal(resolveStrictToolNames('safe', [t]).size, 0)
  assert.equal(resolveStrictToolNames('all', [t]).size, 1)
})
