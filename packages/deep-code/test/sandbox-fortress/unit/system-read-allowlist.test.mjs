import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SYSTEM_READ_PREFIXES,
  isSystemReadPath,
  isUnderWorkspace,
  isUnderAnyWorkspace,
  isAllowlistedRead,
} from '../../../src/sandbox-fortress/rule-engine/systemReadAllowlist.mjs'

// ── F3 paranoid fs-read floor: the tight system-read allowlist that exempts system +
// workspace paths from the paranoid NO-MATCH floor (so the shell can still run commands).

test('A1 system roots are allowed (executables, libs, dyld cache, /etc/ssl)', () => {
  for (const p of [
    '/usr/lib/libc.dylib', '/bin/cat', '/sbin/init', '/lib/x86_64-linux-gnu/libc.so',
    '/etc/ssl/cert.pem', '/private/var/db/dyld/dyld_shared_cache', '/System/Library/Frameworks/x',
    '/Library/Frameworks/y', '/opt/homebrew/bin/node', '/tmp/build', '/proc/self/maps',
  ]) {
    assert.equal(isSystemReadPath(p), true, `expected system: ${p}`)
  }
})

test('A2 home/secret + other-user paths are NOT system (fall through to the floor)', () => {
  for (const p of [
    '/Users/me/.aws/credentials', '/Users/me/.ssh/id_rsa', '/home/me/.config/foo',
    '/root/.bashrc', '/Users/victim/Documents/x', '/mnt/data/secret', '/Volumes/USB/x',
  ]) {
    assert.equal(isSystemReadPath(p), false, `expected NOT system: ${p}`)
  }
})

test('A3 prefix matching respects the / boundary (no /usrx false match)', () => {
  assert.equal(isSystemReadPath('/usr'), true)
  assert.equal(isSystemReadPath('/usrx'), false)
  assert.equal(isSystemReadPath('/etc-backup/x'), false)
  assert.equal(isSystemReadPath('/etc'), true)
})

test('A4 /private is NOT a blanket allow — only /private/{etc,var,tmp} subroots', () => {
  // the macOS realpath forms of /etc, /var (incl. dyld cache + /var/folders temp), /tmp
  assert.equal(isSystemReadPath('/private/etc/hosts'), true)
  assert.equal(isSystemReadPath('/private/var/db/dyld/x'), true)
  assert.equal(isSystemReadPath('/private/var/folders/ab/tmpfile'), true)
  assert.equal(isSystemReadPath('/private/tmp/build'), true)
  // but NOT a blanket /private (a secret stashed under another /private subdir is floored)
  assert.equal(isSystemReadPath('/private/secret'), false)
  assert.equal(isSystemReadPath('/private'), false)
})

test('B1 workspace containment (exact, under, and the / boundary)', () => {
  assert.equal(isUnderWorkspace('/work/proj', '/work/proj'), true)
  assert.equal(isUnderWorkspace('/work/proj/src/a.ts', '/work/proj'), true)
  assert.equal(isUnderWorkspace('/work/projOTHER/a', '/work/proj'), false)
  assert.equal(isUnderWorkspace('/etc/passwd', '/work/proj'), false)
  // trailing slash on the workspace dir is tolerated
  assert.equal(isUnderWorkspace('/work/proj/a', '/work/proj/'), true)
})

test('B2 defensive: empty / non-string inputs → false, never throw', () => {
  assert.equal(isSystemReadPath(''), false)
  assert.equal(isSystemReadPath(undefined), false)
  assert.equal(isUnderWorkspace('/x', ''), false)
  assert.equal(isUnderWorkspace('/x', undefined), false)
  assert.equal(isUnderWorkspace(42, '/work'), false)
})

test('B3 isUnderAnyWorkspace checks every configured workspace dir (originalCwd ∪ additional)', () => {
  const dirs = ['/work/proj', '/extra/dir']
  assert.equal(isUnderAnyWorkspace('/work/proj/src/a', dirs), true)
  assert.equal(isUnderAnyWorkspace('/extra/dir/b', dirs), true)
  assert.equal(isUnderAnyWorkspace('/Users/me/.aws/x', dirs), false)
  assert.equal(isUnderAnyWorkspace('/work/proj/a', 'not-an-array'), false)
  assert.equal(isUnderAnyWorkspace('/work/proj/a', []), false)
})

test('C1 isAllowlistedRead = system OR any workspace dir (array of dirs)', () => {
  assert.equal(isAllowlistedRead('/usr/lib/x', ['/work/proj']), true) // system
  assert.equal(isAllowlistedRead('/work/proj/secret.txt', ['/work/proj']), true) // workspace
  assert.equal(isAllowlistedRead('/extra/dir/x', ['/work/proj', '/extra/dir']), true) // additional working dir
  assert.equal(isAllowlistedRead('/Users/me/.aws/credentials', ['/work/proj']), false) // floored
  assert.equal(isAllowlistedRead('/home/me/.ssh/id_rsa', ['/home/me/proj']), false) // home secret; workspace is /home/me/proj
})

test('D1 SYSTEM_READ_PREFIXES is a non-empty list of absolute prefixes', () => {
  assert.ok(Array.isArray(SYSTEM_READ_PREFIXES) && SYSTEM_READ_PREFIXES.length > 5)
  for (const p of SYSTEM_READ_PREFIXES) assert.ok(p.startsWith('/') && !p.endsWith('/'))
})
