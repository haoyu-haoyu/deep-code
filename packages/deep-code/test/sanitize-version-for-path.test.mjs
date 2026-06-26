import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { sanitizeVersionForPath } from '../src/utils/plugins/sanitizeVersionForPath.mjs'

test('legitimate semver / SHA / tag versions are unchanged', () => {
  for (const v of ['1.2.3', '1.0.0-beta', 'v2.10.4', 'abc123def', '0.0.1', '2024.06.01']) {
    assert.equal(sanitizeVersionForPath(v), v)
  }
})

test('THE FIX: a version of exactly ".." is neutralized so it cannot traverse up', () => {
  assert.equal(sanitizeVersionForPath('..'), '-')
  // and the resulting path stays under the plugin dir, not the marketplace dir
  const base = '/home/u/.claude/plugins/cache/market/plugin'
  assert.equal(join(base, sanitizeVersionForPath('..')), join(base, '-'))
  // (the un-fixed value would normalize to /home/u/.claude/plugins/cache/market)
})

test('"." and longer pure-dot runs are also neutralized', () => {
  assert.equal(sanitizeVersionForPath('.'), '-')
  assert.equal(sanitizeVersionForPath('...'), '-')
})

test('an embedded ".." (with separators) collapses to one harmless segment', () => {
  // slashes -> "-", so this is a single dir name, not a traversal
  assert.equal(sanitizeVersionForPath('../../etc'), '..-..-etc')
  const base = '/base/cache/m/p'
  assert.equal(join(base, sanitizeVersionForPath('../../etc')), join(base, '..-..-etc'))
})

test('separators and other unsafe chars become "-" (unchanged from before)', () => {
  assert.equal(sanitizeVersionForPath('a/b\\c'), 'a-b-c')
  assert.equal(sanitizeVersionForPath('1.0.0+build meta'), '1.0.0-build-meta')
})

test('empty / nullish version yields a stable non-empty token (no un-versioned collapse)', () => {
  assert.equal(sanitizeVersionForPath(''), '-')
  assert.equal(sanitizeVersionForPath(undefined), '-')
  assert.equal(sanitizeVersionForPath(null), '-')
})

test('the result is never a path.join traversal token, for adversarial inputs', () => {
  for (const v of ['..', '.', '...', '../..', './.', '....', '../', './', '/..']) {
    const s = sanitizeVersionForPath(v)
    assert.notEqual(s, '.')
    assert.notEqual(s, '..')
    assert.notEqual(s, '')
    // joining can only descend, never escape the plugin dir
    const base = '/b/cache/m/p'
    const joined = join(base, s)
    assert.ok(joined.startsWith(base + '/'), `escaped for input ${JSON.stringify(v)} -> ${joined}`)
  }
})
