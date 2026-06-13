import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseShellArguments } from '../src/services/mcp/promptArguments.mjs'

// Local equivalent of lodash zipObject (which client.ts uses): zipObject(keys,
// values) → { keys[i]: values[i] }, with undefined for a missing value. Inlined so
// the test has no bare lodash-es import (not node-resolvable under `npm ci` in CI).
const zipObject = (keys, values) =>
  Object.fromEntries(keys.map((key, i) => [key, values[i]]))

// client.ts builds the MCP prompts/get `arguments` as zipObject(argNames, argsArray).
// This mirrors that to prove the parse fix produces correct server-bound arguments.
const buildArgs = (argNames, input) =>
  JSON.parse(JSON.stringify(zipObject(argNames, parseShellArguments(input))))

test('parseShellArguments honors quotes and collapses whitespace (vs the old split)', () => {
  assert.deepEqual(parseShellArguments('"New York" celsius'), ['New York', 'celsius'])
  assert.deepEqual(parseShellArguments('x   y'), ['x', 'y'])
  assert.deepEqual(parseShellArguments(''), [])
  assert.deepEqual(parseShellArguments('   '), [])
  // simple single/two-word cases match the old split exactly (no behavior change)
  assert.deepEqual(parseShellArguments('hello'), ['hello'])
  assert.deepEqual(parseShellArguments('a b'), ['a', 'b'])
  // $VAR is preserved literally (not expanded), matching parseArguments
  assert.deepEqual(parseShellArguments('$HOME x'), ['$HOME', 'x'])
  // shell operators (|, ;, &&) parse to non-string objects and must be filtered out
  // (they can't be a prompt argument value), keeping only the literal string tokens
  assert.deepEqual(parseShellArguments('a | b'), ['a', 'b'])
})

test('MCP prompt arguments are correct for quoted/multi-word/empty inputs', () => {
  // a quoted multi-word value reaches the server intact (old split → {city:'"New', unit:'York"'})
  assert.deepEqual(buildArgs(['city', 'unit'], '"New York" celsius'), {
    city: 'New York',
    unit: 'celsius',
  })
  // runs of whitespace don't swallow the value (old → {city:'x', unit:''})
  assert.deepEqual(buildArgs(['city', 'unit'], 'x   y'), { city: 'x', unit: 'y' })
  // empty input omits all args (old → {firstArg:''}; ''.split(' ') === [''])
  assert.deepEqual(buildArgs(['firstArg'], ''), {})

  // demonstrate the OLD split actually corrupted these (regression guard rationale)
  const oldSplit = (argNames, input) =>
    JSON.parse(JSON.stringify(zipObject(argNames, input.split(' '))))
  assert.deepEqual(oldSplit(['city', 'unit'], '"New York" celsius'), {
    city: '"New',
    unit: 'York"',
  })
})
