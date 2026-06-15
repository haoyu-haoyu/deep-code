import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveFrontmatterModel } from '../src/utils/frontmatterModel.mjs'

test('inherit maps to undefined (skill/command "no override" semantics)', () => {
  assert.equal(resolveFrontmatterModel('inherit'), undefined)
})

test('the inherit compare is EXACT — case/whitespace variants are NOT treated as inherit', () => {
  // The skill/command loaders historically used `frontmatter.model === 'inherit'`
  // (exact), distinct from the agent loader which lowercases+trims. A variant
  // must pass through verbatim to parseUserSpecifiedModel, NOT collapse to
  // undefined. This pins the exact-compare against a future edit that adopted
  // the agent loader's trim/lowercase semantics.
  assert.equal(resolveFrontmatterModel('Inherit'), 'Inherit')
  assert.equal(resolveFrontmatterModel('INHERIT'), 'INHERIT')
  assert.equal(resolveFrontmatterModel(' inherit '), ' inherit ')
  assert.equal(resolveFrontmatterModel('inherit '), 'inherit ')
})

test('non-empty strings pass through verbatim to parseUserSpecifiedModel', () => {
  assert.equal(resolveFrontmatterModel('deepseek-chat'), 'deepseek-chat')
  assert.equal(resolveFrontmatterModel('claude-opus-4-8'), 'claude-opus-4-8')
  // whitespace-only is preserved (the old truthiness check passed it through too)
  assert.equal(resolveFrontmatterModel('   '), '   ')
  // a leading/trailing-space model name is returned untrimmed (parseUserSpecifiedModel trims)
  assert.equal(resolveFrontmatterModel(' sonnet '), ' sonnet ')
})

test('falsy values map to undefined (no model specified)', () => {
  assert.equal(resolveFrontmatterModel(undefined), undefined)
  assert.equal(resolveFrontmatterModel(null), undefined)
  assert.equal(resolveFrontmatterModel(''), undefined)
  assert.equal(resolveFrontmatterModel(0), undefined)
  assert.equal(resolveFrontmatterModel(false), undefined)
})

test('truthy NON-string values map to undefined instead of throwing (the bug)', () => {
  // Previously these reached parseUserSpecifiedModel(...).trim() → TypeError →
  // swallowed by the per-entry try/catch → the whole skill/command vanished.
  assert.equal(resolveFrontmatterModel(4), undefined)
  assert.equal(resolveFrontmatterModel(1.5), undefined)
  assert.equal(resolveFrontmatterModel(true), undefined)
  assert.equal(resolveFrontmatterModel(['a', 'b']), undefined)
  assert.equal(resolveFrontmatterModel([]), undefined)
  assert.equal(resolveFrontmatterModel({ model: 'x' }), undefined)
  assert.equal(resolveFrontmatterModel({}), undefined)
})

test('never throws for any input type', () => {
  for (const v of [
    'inherit',
    'deepseek-chat',
    '',
    '   ',
    undefined,
    null,
    0,
    1,
    NaN,
    Infinity,
    true,
    false,
    [],
    ['a'],
    {},
    Symbol('s'),
    1n,
  ]) {
    assert.doesNotThrow(() => resolveFrontmatterModel(v))
  }
})
