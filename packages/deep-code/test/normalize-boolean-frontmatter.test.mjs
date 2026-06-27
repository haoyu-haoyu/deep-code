import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBooleanFrontmatter } from '../src/utils/normalizeBooleanFrontmatter.mjs'

test('a real YAML boolean is returned as-is', () => {
  assert.equal(normalizeBooleanFrontmatter(true), true)
  assert.equal(normalizeBooleanFrontmatter(false), false)
})

test('the canonical string "true"/"false" works (prior behavior preserved)', () => {
  assert.equal(normalizeBooleanFrontmatter('true'), true)
  assert.equal(normalizeBooleanFrontmatter('false'), false)
})

test('THE FIX: a whitespace-padded "true" no longer fails open', () => {
  // YAML preserves whitespace inside quoted scalars: `field: " true "` -> ' true '.
  // The old `=== 'true'` rejected this, silently dropping the restriction.
  assert.equal(normalizeBooleanFrontmatter(' true '), true)
  assert.equal(normalizeBooleanFrontmatter('\ttrue\n'), true)
})

test('THE FIX: a cased "True"/"TRUE" is honored', () => {
  // A quoted cased scalar (`field: "True"`) is preserved by the YAML parser as
  // the STRING "True", which the old `=== 'true'` check rejected.
  assert.equal(normalizeBooleanFrontmatter('True'), true)
  assert.equal(normalizeBooleanFrontmatter('TRUE'), true)
  assert.equal(normalizeBooleanFrontmatter('  TrUe  '), true)
})

test('padded/cased "false" stays false (no accidental inversion)', () => {
  assert.equal(normalizeBooleanFrontmatter(' false '), false)
  assert.equal(normalizeBooleanFrontmatter('False'), false)
  assert.equal(normalizeBooleanFrontmatter('FALSE'), false)
})

test('non-true strings are false', () => {
  assert.equal(normalizeBooleanFrontmatter('yes'), false)
  assert.equal(normalizeBooleanFrontmatter('1'), false)
  assert.equal(normalizeBooleanFrontmatter('truthy'), false)
  assert.equal(normalizeBooleanFrontmatter(''), false)
  assert.equal(normalizeBooleanFrontmatter('   '), false)
})

test('non-string / non-boolean values are false (matches prior strict semantics)', () => {
  assert.equal(normalizeBooleanFrontmatter(undefined), false)
  assert.equal(normalizeBooleanFrontmatter(null), false)
  assert.equal(normalizeBooleanFrontmatter(1), false)
  assert.equal(normalizeBooleanFrontmatter(0), false)
  // An array whose String() would be "true" must NOT become true.
  assert.equal(normalizeBooleanFrontmatter(['true']), false)
  assert.equal(normalizeBooleanFrontmatter({}), false)
})
