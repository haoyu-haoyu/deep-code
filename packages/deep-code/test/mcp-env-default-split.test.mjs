import assert from 'node:assert/strict'
import { test } from 'node:test'

import { splitEnvVarDefault } from '../src/services/mcp/splitEnvVarDefault.mjs'

test('splitEnvVarDefault: no default → undefined (byte-identical to the old split)', () => {
  assert.deepEqual(splitEnvVarDefault('VAR'), { varName: 'VAR', defaultValue: undefined })
  assert.deepEqual(splitEnvVarDefault(''), { varName: '', defaultValue: undefined })
})

test('splitEnvVarDefault: a simple default', () => {
  assert.deepEqual(splitEnvVarDefault('VAR:-default'), {
    varName: 'VAR',
    defaultValue: 'default',
  })
})

test('splitEnvVarDefault: a default that itself contains ":-" keeps the whole tail (the fix)', () => {
  // The OLD `split(':-', 2)` discarded the tail, yielding '30' here.
  assert.deepEqual(splitEnvVarDefault('VAR:-30:-fallback'), {
    varName: 'VAR',
    defaultValue: '30:-fallback',
  })
  assert.deepEqual(splitEnvVarDefault('FLAG:-a:-b:-c'), {
    varName: 'FLAG',
    defaultValue: 'a:-b:-c',
  })
})

test('splitEnvVarDefault: the common URL default (no ":-" inside) is unaffected', () => {
  assert.deepEqual(splitEnvVarDefault('URL:-http://host:3000'), {
    varName: 'URL',
    defaultValue: 'http://host:3000',
  })
})

test('splitEnvVarDefault: an empty default is preserved as ""', () => {
  assert.deepEqual(splitEnvVarDefault('VAR:-'), { varName: 'VAR', defaultValue: '' })
})

test('splitEnvVarDefault: a leading ":-" yields an empty var name', () => {
  assert.deepEqual(splitEnvVarDefault(':-default'), { varName: '', defaultValue: 'default' })
})
