import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lockdownPermissionClears } from '../src/utils/permissions/lockdownPermissionClears.mjs'

const SOURCES = ['userSettings', 'projectSettings', 'localSettings', 'cliArg', 'session']

test('THE FIX: deny is NEVER cleared under lockdown (a deny only tightens)', () => {
  const ops = lockdownPermissionClears(SOURCES, true)
  assert.ok(ops.every(o => o.behavior !== 'deny'), 'no clear op targets the deny behavior')
  // specifically: cliArg/session deny (e.g. --disallow-tools) must survive
  assert.equal(ops.filter(o => o.source === 'cliArg' && o.behavior === 'deny').length, 0)
  assert.equal(ops.filter(o => o.source === 'session' && o.behavior === 'deny').length, 0)
})

test('GRANT behaviors (allow/ask) ARE cleared for every non-managed source', () => {
  const ops = lockdownPermissionClears(SOURCES, true)
  for (const source of SOURCES) {
    assert.ok(ops.some(o => o.source === source && o.behavior === 'allow'), `${source} allow cleared`)
    assert.ok(ops.some(o => o.source === source && o.behavior === 'ask'), `${source} ask cleared`)
  }
  // exactly 2 behaviors (allow, ask) per source, no more
  assert.equal(ops.length, SOURCES.length * 2)
})

test('lockdown OFF clears nothing', () => {
  assert.deepEqual(lockdownPermissionClears(SOURCES, false), [])
  assert.deepEqual(lockdownPermissionClears(['cliArg'], false), [])
})

test('only the GRANT behaviors are emitted, in allow-then-ask order', () => {
  assert.deepEqual(lockdownPermissionClears(['cliArg'], true), [
    { source: 'cliArg', behavior: 'allow' },
    { source: 'cliArg', behavior: 'ask' },
  ])
})

test('empty source list yields no ops even under lockdown', () => {
  assert.deepEqual(lockdownPermissionClears([], true), [])
})
