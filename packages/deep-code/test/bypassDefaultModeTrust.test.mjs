import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isBypassDefaultModeTrusted,
  TRUSTED_BYPASS_DEFAULT_MODE_SOURCES,
} from '../src/utils/settings/bypassDefaultModeTrust.mjs'

// A reader that maps each source name to its (stubbed) parsed settings JSON.
function reader(map) {
  return source => map[source] ?? null
}

const bypass = { permissions: { defaultMode: 'bypassPermissions' } }

test('THE HOLE: a project-only bypass default is NOT trusted', () => {
  assert.equal(
    isBypassDefaultModeTrusted(reader({ projectSettings: bypass })),
    false,
  )
})

test('each trusted source backing the bypass default → trusted', () => {
  for (const source of TRUSTED_BYPASS_DEFAULT_MODE_SOURCES) {
    assert.equal(
      isBypassDefaultModeTrusted(reader({ [source]: bypass })),
      true,
      `${source} should be trusted`,
    )
  }
})

test('projectSettings is NEVER queried (cannot influence the result)', () => {
  // a reader that THROWS for projectSettings proves the predicate never reads it
  const r = source => {
    if (source === 'projectSettings') throw new Error('must not read projectSettings')
    return null
  }
  assert.equal(isBypassDefaultModeTrusted(r), false)
  // and even when projectSettings WOULD say bypass, a throwing reader still
  // yields false because the loop only visits trusted sources
  const r2 = source => {
    if (source === 'projectSettings') throw new Error('must not read projectSettings')
    if (source === 'userSettings') return bypass
    return null
  }
  assert.equal(isBypassDefaultModeTrusted(r2), true)
})

test('a non-bypass trusted defaultMode does not count', () => {
  assert.equal(
    isBypassDefaultModeTrusted(
      reader({ userSettings: { permissions: { defaultMode: 'acceptEdits' } } }),
    ),
    false,
  )
  assert.equal(
    isBypassDefaultModeTrusted(
      reader({ localSettings: { permissions: { defaultMode: 'plan' } } }),
    ),
    false,
  )
})

test('missing / empty / malformed settings → false (fail-closed)', () => {
  assert.equal(isBypassDefaultModeTrusted(reader({})), false)
  assert.equal(isBypassDefaultModeTrusted(reader({ userSettings: null })), false)
  assert.equal(isBypassDefaultModeTrusted(reader({ userSettings: {} })), false)
  assert.equal(
    isBypassDefaultModeTrusted(reader({ userSettings: { permissions: {} } })),
    false,
  )
  // a non-function reader fails closed
  assert.equal(isBypassDefaultModeTrusted(undefined), false)
  assert.equal(isBypassDefaultModeTrusted(null), false)
})

test('a trusted source counts even if projectSettings also sets a different mode', () => {
  assert.equal(
    isBypassDefaultModeTrusted(
      reader({
        projectSettings: { permissions: { defaultMode: 'default' } },
        policySettings: bypass,
      }),
    ),
    true,
  )
})
