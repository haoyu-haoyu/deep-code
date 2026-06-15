import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyPermissionRule } from '../src/utils/permissions/permissionRuleClassify.mjs'

// Faithful ports of the real shellRuleMatching.ts helpers (injected into the
// leaf). Kept in sync with permissionRuleExtractPrefix / hasWildcards.
const extractPrefix = rule => {
  const m = rule.match(/^(.+):\*$/)
  return m?.[1] ?? null
}
const hasWildcards = pattern => {
  if (pattern.endsWith(':*')) return false
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      let backslashes = 0
      let j = i - 1
      while (j >= 0 && pattern[j] === '\\') {
        backslashes++
        j--
      }
      if (backslashes % 2 === 0) return true
    }
  }
  return false
}
const classify = rule => classifyPermissionRule(rule, extractPrefix, hasWildcards)

test('legacy :* rules with NO wildcard in the prefix stay prefix (unchanged)', () => {
  assert.deepEqual(classify('npm:*'), { type: 'prefix', prefix: 'npm' })
  assert.deepEqual(classify('git status:*'), { type: 'prefix', prefix: 'git status' })
  assert.deepEqual(classify('docker run:*'), { type: 'prefix', prefix: 'docker run' })
})

test('MIXED `*` + trailing `:*` rules route to wildcard (the fix)', () => {
  // Previously classified as prefix `docker run --rm -v *` (literal *, inert).
  assert.deepEqual(classify('docker run --rm -v *:*'), {
    type: 'wildcard',
    pattern: 'docker run --rm -v *:*',
  })
  assert.deepEqual(classify('curl http*:*'), {
    type: 'wildcard',
    pattern: 'curl http*:*',
  })
})

test('plain wildcard rules (no trailing :*) stay wildcard', () => {
  assert.equal(classify('echo *').type, 'wildcard')
  assert.equal(classify('rm -rf /*').type, 'wildcard')
})

test('rules with no wildcard and no :* are exact', () => {
  assert.deepEqual(classify('ls -la'), { type: 'exact', command: 'ls -la' })
  assert.deepEqual(classify('git status'), { type: 'exact', command: 'git status' })
})

test('an escaped \\* in the prefix is NOT a wildcard → stays prefix', () => {
  // `\*` is a literal asterisk, not a wildcard, so the legacy prefix branch holds.
  const rule = 'echo \\*:*'
  assert.deepEqual(classify(rule), { type: 'prefix', prefix: 'echo \\*' })
})

test('the routing differs from the buggy original only on mixed rules', () => {
  // Original always took the prefix branch for any `:*`-suffixed rule.
  const buggyOriginal = rule => {
    const prefix = extractPrefix(rule)
    if (prefix !== null) return { type: 'prefix', prefix }
    if (hasWildcards(rule)) return { type: 'wildcard', pattern: rule }
    return { type: 'exact', command: rule }
  }
  for (const rule of ['npm:*', 'git status:*', 'docker run:*', 'ls -la', 'echo *']) {
    assert.deepEqual(classify(rule), buggyOriginal(rule), `unchanged for ${rule}`)
  }
  // Only the mixed rules change (prefix → wildcard).
  for (const rule of ['docker run --rm -v *:*', 'curl http*:*']) {
    assert.equal(buggyOriginal(rule).type, 'prefix')
    assert.equal(classify(rule).type, 'wildcard')
  }
})
