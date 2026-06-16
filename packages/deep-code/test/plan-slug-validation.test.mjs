import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isValidPlanSlug } from '../src/utils/isValidPlanSlug.mjs'

test('accepts a generateWordSlug-shaped slug (adjective-verb-noun)', () => {
  assert.equal(isValidPlanSlug('brave-running-otter'), true)
  assert.equal(isValidPlanSlug('a'), true)
  assert.equal(isValidPlanSlug('plan_1-final2'), true) // digits + underscore allowed
})

test('rejects path-traversal payloads (the bug)', () => {
  assert.equal(isValidPlanSlug('../../../../tmp/evil'), false)
  assert.equal(isValidPlanSlug('..'), false)
  assert.equal(isValidPlanSlug('.'), false)
  assert.equal(isValidPlanSlug('/etc/passwd'), false)
  assert.equal(isValidPlanSlug('a/b'), false) // forward slash
  assert.equal(isValidPlanSlug('a\\b'), false) // backslash (Windows separator)
  assert.equal(isValidPlanSlug('foo.md'), false) // dot — would let `..md`-style tricks creep in
  assert.equal(isValidPlanSlug('foo bar'), false) // space
  assert.equal(isValidPlanSlug('a\0b'), false) // NUL
  assert.equal(isValidPlanSlug('a\nb'), false) // newline
})

test('rejects empty / non-string', () => {
  assert.equal(isValidPlanSlug(''), false)
  assert.equal(isValidPlanSlug(undefined), false)
  assert.equal(isValidPlanSlug(null), false)
  assert.equal(isValidPlanSlug(42), false)
  assert.equal(isValidPlanSlug({}), false)
})

test('the resulting join stays inside the plans dir for valid slugs but escapes for the rejected ones', async () => {
  const { join } = await import('node:path')
  const plansDir = '/home/u/.claude/plans'
  // a valid slug resolves under plansDir
  assert.ok(join(plansDir, `${'brave-running-otter'}.md`).startsWith(plansDir + '/'))
  // the traversal payload would escape — and isValidPlanSlug rejects it before it can
  const evil = '../../../../tmp/evil'
  assert.equal(join(plansDir, `${evil}.md`), '/tmp/evil.md')
  assert.equal(isValidPlanSlug(evil), false)
})
