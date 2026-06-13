import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildKeychainFindArgs,
  buildKeychainDeleteArgs,
} from '../src/utils/secureStorage/keychainArgs.mjs'

// The macOS keychain read()/delete() build their `security` invocation as an
// argv ARRAY (shell=false) instead of interpolating $USER into a shell command
// STRING. A username (or service-name fragment) with a shell-significant char
// must stay a SINGLE literal token — not split into extra args, and never
// shell-expanded — so it can't break quoting or inject a command.

test('find/delete argv place username + service name as discrete literal tokens', () => {
  assert.deepEqual(buildKeychainFindArgs('alice', 'deepcode.credentials'), [
    'find-generic-password',
    '-a',
    'alice',
    '-w',
    '-s',
    'deepcode.credentials',
  ])
  assert.deepEqual(buildKeychainDeleteArgs('alice', 'deepcode.credentials'), [
    'delete-generic-password',
    '-a',
    'alice',
    '-s',
    'deepcode.credentials',
  ])
})

test('a username with shell-significant characters stays ONE literal arg (no split, no expansion)', () => {
  const hostile = 'a b"; rm -rf ~ && $(whoami)`id`'
  const find = buildKeychainFindArgs(hostile, 'svc')
  // the username occupies exactly the slot after -a, verbatim
  assert.equal(find[find.indexOf('-a') + 1], hostile)
  // and it is exactly one element — not split on spaces/quotes
  assert.equal(find.filter(a => a === hostile).length, 1)
  assert.equal(find.length, 6)

  const del = buildKeychainDeleteArgs(hostile, 'svc"; reboot')
  assert.equal(del[del.indexOf('-a') + 1], hostile)
  assert.equal(del[del.indexOf('-s') + 1], 'svc"; reboot')
  assert.equal(del.length, 5)
})
