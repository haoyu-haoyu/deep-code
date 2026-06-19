import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveStrictToolNames,
  schemaClosesAnOpenMap,
} from '../src/tools/resolveStrictToolNames.mjs'

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

test("'safe' accepts a strict-shaped tool carrying a V4-supported constraint (minLength)", () => {
  // The sanitizer now KEEPS minLength/maxLength/minItems/maxItems (V4 /beta
  // accepts them), so an all-required + closed schema carrying one IS a true
  // no-op and is safe-eligible.
  const t = tool('Len', {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string', minLength: 3 } },
    required: ['a'],
  })
  assert.equal(resolveStrictToolNames('safe', [t]).size, 1)
  assert.equal(resolveStrictToolNames('all', [t]).size, 1)
})

// --- open maps are excluded from 'all'/'nullable' (sanitizer would close them) -

const record = {
  // z.record(z.string(), z.string()) → an open value-typed map.
  type: 'object',
  additionalProperties: { type: 'string' },
  properties: {},
  required: [],
}
const passthrough = {
  // z.object({...}).passthrough() → additionalProperties: {} (accept any).
  type: 'object',
  additionalProperties: {},
  properties: { a: { type: 'string' } },
  required: ['a'],
}
const openTrue = {
  type: 'object',
  additionalProperties: true,
  properties: {},
  required: [],
}
const patternMap = {
  type: 'object',
  patternProperties: { '^x-': { type: 'string' } },
  properties: {},
  required: [],
}
const nestedRecord = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meta: { type: 'object', additionalProperties: { type: 'number' } }, // nested open map
  },
  required: ['meta'],
}

test("'all'/'nullable' EXCLUDE a tool with a schema-valued additionalProperties (record)", () => {
  for (const mode of ['all', 'nullable']) {
    assert.equal(resolveStrictToolNames(mode, [tool('Rec', record)]).size, 0, mode)
    assert.equal(resolveStrictToolNames(mode, [tool('Pass', passthrough)]).size, 0, mode)
    assert.equal(resolveStrictToolNames(mode, [tool('OpenT', openTrue)]).size, 0, mode)
    assert.equal(resolveStrictToolNames(mode, [tool('Pat', patternMap)]).size, 0, mode)
    // A nested open map excludes the whole tool too.
    assert.equal(resolveStrictToolNames(mode, [tool('Nest', nestedRecord)]).size, 0, mode)
  }
})

test("'all'/'nullable' still select a normal closed tool, and an absent-additionalProperties tool", () => {
  for (const mode of ['all', 'nullable']) {
    assert.equal(resolveStrictToolNames(mode, [tool('Closed', closedAllRequired)]).size, 1, mode)
    // absent additionalProperties is the normal closed-object case strict is MEANT
    // to close — NOT an explicit open map, so it stays selectable.
    assert.equal(resolveStrictToolNames(mode, [tool('Open', openExtra)]).size, 1, mode)
  }
})

test('open maps do not remove OTHER tools from the same batch', () => {
  const tools = [tool('Rec', record), tool('Closed', closedAllRequired)]
  assert.deepEqual([...resolveStrictToolNames('all', tools)], ['Closed'])
})

test('schemaClosesAnOpenMap: detects open maps, ignores closed/absent', () => {
  assert.equal(schemaClosesAnOpenMap(record), true)
  assert.equal(schemaClosesAnOpenMap(passthrough), true)
  assert.equal(schemaClosesAnOpenMap(openTrue), true)
  assert.equal(schemaClosesAnOpenMap(patternMap), true)
  assert.equal(schemaClosesAnOpenMap(nestedRecord), true)
  assert.equal(schemaClosesAnOpenMap(closedAllRequired), false)
  assert.equal(schemaClosesAnOpenMap(openExtra), false) // absent ≠ explicit open (HAS properties)
  assert.equal(schemaClosesAnOpenMap(null), false)
  assert.equal(schemaClosesAnOpenMap({ type: 'string' }), false)
})

test('schemaClosesAnOpenMap: a property-less object is JSON-Schema default-open', () => {
  // A bare {type:'object'} (no properties, no additionalProperties) defaults to
  // additionalProperties:true — the sanitizer would close it to accept-only-{}.
  for (const open of [
    { type: 'object' },
    { type: 'object', description: 'a free-form filter' },
    { type: 'object', properties: {} }, // declares ZERO properties
    { type: ['object', 'null'] }, // nullable free-form object
    { type: 'object', minProperties: 1 }, // constraint-only, still property-less
  ]) {
    assert.equal(schemaClosesAnOpenMap(open), true, JSON.stringify(open))
  }
  // An object WITH declared properties stays closeable (strict's intended job).
  assert.equal(schemaClosesAnOpenMap({ type: 'object', properties: { a: { type: 'string' } } }), false)
  assert.equal(schemaClosesAnOpenMap({ type: 'object', additionalProperties: false }), false)
})

test('a nested property-less free-form object excludes the tool under all/nullable', () => {
  // top object HAS properties but carries a nested free-form filter:{type:'object'}
  const mcpShaped = {
    type: 'object',
    properties: {
      query: { type: 'string' },
      filter: { type: 'object' }, // free-form, default-open
      metadata: { type: 'object', description: 'arbitrary' },
    },
    required: ['query'],
  }
  for (const mode of ['all', 'nullable']) {
    assert.equal(
      resolveStrictToolNames(mode, [tool('Search', mcpShaped)]).size,
      0,
      `${mode}: a tool with a nested free-form object must be excluded`,
    )
  }
  // a fully-closed / declared-properties batch is still byte-identically selected
  assert.deepEqual(
    [...resolveStrictToolNames('all', [tool('Closed', closedAllRequired), tool('Open', openExtra)])].sort(),
    ['Closed', 'Open'],
  )
})

test('a no-arg z.strictObject({}) tool ({properties:{},additionalProperties:false}) stays selectable', () => {
  // The no-arg tools (CronList/TaskList/TeamDelete/...) emit an EMPTY properties
  // object WITH additionalProperties:false. That is a genuinely closed empty
  // object — strict can enforce it — so it must NOT be swept up by the new
  // property-less clause (the `'additionalProperties' in schema` guard excludes it).
  const noArg = { type: 'object', properties: {}, additionalProperties: false, required: [] }
  assert.equal(schemaClosesAnOpenMap(noArg), false)
  for (const mode of ['all', 'nullable']) {
    assert.equal(resolveStrictToolNames(mode, [tool('CronList', noArg)]).size, 1, mode)
  }
})
