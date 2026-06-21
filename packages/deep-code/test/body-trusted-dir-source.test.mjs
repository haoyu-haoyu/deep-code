import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bodyTrustedWorkingDirSet,
  isBodyTrustedDirSource,
} from '../src/utils/permissions/bodyTrustedDirSource.mjs'

test('the two WORKSPACE-controlled settings sources are NOT body-trusted', () => {
  // an opened repo controls these two .claude files
  assert.equal(isBodyTrustedDirSource('projectSettings'), false)
  assert.equal(isBodyTrustedDirSource('localSettings'), false)
})

test('CLI / session / user-global sources ARE body-trusted', () => {
  assert.equal(isBodyTrustedDirSource('cliArg'), true) // --add-dir / --settings / managed
  assert.equal(isBodyTrustedDirSource('session'), true) // mid-session /add-dir
  assert.equal(isBodyTrustedDirSource('userSettings'), true) // ~/.claude global
})

test('an unknown/future source is UNtrusted (fail-secure allowlist)', () => {
  assert.equal(isBodyTrustedDirSource('somethingNew'), false)
  assert.equal(isBodyTrustedDirSource(undefined), false)
  assert.equal(isBodyTrustedDirSource(''), false)
})

test('the body-trusted dir set always includes the workspace root', () => {
  const set = bodyTrustedWorkingDirSet('/ws', [])
  assert.deepEqual([...set], ['/ws'])
})

test('THE FIX: a project/local-settings dir is excluded; CLI/user dirs are kept', () => {
  const entries = [
    { path: '/evil', source: 'projectSettings' }, // opened-repo additionalDirectories:["/evil"]
    { path: '/local', source: 'localSettings' },
    { path: '/cli', source: 'cliArg' }, // genuine --add-dir
    { path: '/userglobal', source: 'userSettings' },
  ]
  const set = bodyTrustedWorkingDirSet('/ws', entries)
  assert.ok(set.has('/ws'), 'workspace root present')
  assert.ok(set.has('/cli'), 'CLI --add-dir trusted')
  assert.ok(set.has('/userglobal'), 'user-global trusted')
  assert.ok(!set.has('/evil'), 'project-settings dir EXCLUDED (the re-open)')
  assert.ok(!set.has('/local'), 'local-settings dir EXCLUDED')
  assert.equal(set.size, 3)
})

test('a malformed entry never throws and is skipped', () => {
  const set = bodyTrustedWorkingDirSet('/ws', [null, undefined, { path: '/x' }])
  // {path:'/x'} has source undefined -> untrusted -> excluded; nulls skipped
  assert.deepEqual([...set].sort(), ['/ws'])
})
