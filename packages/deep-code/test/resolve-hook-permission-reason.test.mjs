import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveHookPermissionReason } from '../src/utils/resolveHookPermissionReason.mjs'

test('the hook-specific reason wins when present', () => {
  assert.equal(resolveHookPermissionReason('specific', 'top-level'), 'specific')
})

test('THE FIX: an ABSENT hook-specific reason does NOT clobber the top-level reason', () => {
  // a deny hook that supplied only a top-level `reason` must keep it
  assert.equal(
    resolveHookPermissionReason(undefined, 'Blocked by security policy'),
    'Blocked by security policy',
  )
})

test('an empty-string hook-specific reason also yields to the top-level one', () => {
  assert.equal(resolveHookPermissionReason('', 'top-level'), 'top-level')
})

test('both absent yields undefined (no reason)', () => {
  assert.equal(resolveHookPermissionReason(undefined, undefined), undefined)
})

test('a top-level reason of undefined with a specific reason keeps the specific', () => {
  assert.equal(resolveHookPermissionReason('only-specific', undefined), 'only-specific')
})
