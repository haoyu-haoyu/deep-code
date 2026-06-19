import { test } from 'node:test'
import assert from 'node:assert/strict'

import { firstChainDenyMatch } from '../src/utils/permissions/firstChainDenyMatch.mjs'

// A symlink chain as getPathsForPermissionCheck returns it: original input, then
// each intermediate readlink target, then the final realpath.
const chain = ['links/a', 'links/b', 'real/secret.txt', '/private/real/secret.txt']

test('returns the first chain path a deny rule matches (intermediate hop)', () => {
  // deny rule targets the MIDDLE hop links/b — Bash used to only check the final
  // realpath and miss this.
  const hit = firstChainDenyMatch(chain, p => (p === 'links/b' ? { rule: 'Deny(b)' } : null))
  assert.deepEqual(hit, { path: 'links/b', rule: { rule: 'Deny(b)' } })
})

test('returns the first match in chain order (original name wins over final)', () => {
  // both the original name and the final realpath are denied → first (original) wins
  const hit = firstChainDenyMatch(chain, p =>
    p === 'links/a' || p === '/private/real/secret.txt' ? `deny:${p}` : null,
  )
  assert.deepEqual(hit, { path: 'links/a', rule: 'deny:links/a' })
})

test('returns null when no chain path is denied', () => {
  assert.equal(firstChainDenyMatch(chain, () => null), null)
  // undefined (matchingRuleForInput can return null) is treated as no-match
  assert.equal(firstChainDenyMatch(chain, () => undefined), null)
})

test('an empty chain is null (no syscalls, no match)', () => {
  assert.equal(firstChainDenyMatch([], () => 'x'), null)
})

test('matches the FINAL realpath when only it is denied (parity with the old behavior)', () => {
  const hit = firstChainDenyMatch(chain, p =>
    p === '/private/real/secret.txt' ? 'deny-final' : null,
  )
  assert.deepEqual(hit, { path: '/private/real/secret.txt', rule: 'deny-final' })
})
