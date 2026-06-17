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
