import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGlobBaseDirectory,
  resolveGlobSearchDir,
} from '../src/utils/globSearchDir.mjs'

// Tests run on a POSIX host, so `isAbsolute` is the POSIX form (matching glob.ts's
// platform-default behavior — a drive-letter pattern is NOT absolute here).

test('resolveGlobSearchDir: a relative pattern searches the caller cwd (unchanged)', () => {
  const cwd = '/work/proj'
  for (const p of ['*.ts', 'src/**/*.tsx', 'a/b/c.txt', '**/test_*.mjs']) {
    assert.equal(resolveGlobSearchDir(p, cwd, 'linux'), cwd, p)
  }
})

test('resolveGlobSearchDir: an ABSOLUTE pattern re-roots OUTSIDE cwd (the gate must see this)', () => {
  const cwd = '/work/proj'
  // These are the escape vectors: the search root is NOT cwd.
  assert.equal(resolveGlobSearchDir('/etc/*.conf', cwd, 'linux'), '/etc')
  assert.equal(resolveGlobSearchDir('/Users/victim/.ssh/*', cwd, 'linux'), '/Users/victim/.ssh')
  // an absolute literal (no glob char) → base dir is its dirname
  assert.equal(resolveGlobSearchDir('/etc/passwd', cwd, 'linux'), '/etc')
  // root-level glob → '/'
  assert.equal(resolveGlobSearchDir('/*.txt', cwd, 'linux'), '/')
})

test('resolveGlobSearchDir: a ~ pattern is NOT a real escape (stays relative to cwd)', () => {
  // node isAbsolute('~/x') is false → ripgrep looks for a literal '~' dir under cwd.
  assert.equal(resolveGlobSearchDir('~/secrets/*', '/work', 'linux'), '/work')
  // a Windows drive pattern is not absolute on a POSIX host → cwd (matches glob.ts)
  assert.equal(resolveGlobSearchDir('C:/Users/*', '/work', 'windows'), '/work')
})

test('resolveGlobSearchDir is idempotent (glob() re-derives the same root getPath returned)', () => {
  const cwd = '/work/proj'
  for (const p of ['/etc/*.conf', '/a/b/**/*.ts', '/etc/passwd', '*.ts', 'src/**']) {
    const once = resolveGlobSearchDir(p, cwd, 'linux')
    const twice = resolveGlobSearchDir(p, once, 'linux')
    assert.equal(twice, once, `not idempotent for ${p}`)
  }
})

test('extractGlobBaseDirectory: known shapes (the relocated logic, byte-for-byte)', () => {
  // relative glob → empty baseDir + whole pattern
  assert.deepEqual(extractGlobBaseDirectory('*.ts', 'linux'), { baseDir: '', relativePattern: '*.ts' })
  // base before the first glob char
  assert.deepEqual(extractGlobBaseDirectory('src/**/*.ts', 'linux'), { baseDir: 'src', relativePattern: '**/*.ts' })
  // absolute base
  assert.deepEqual(extractGlobBaseDirectory('/etc/*.conf', 'linux'), { baseDir: '/etc', relativePattern: '*.conf' })
  // literal path (no glob char) → dirname/basename split
  assert.deepEqual(extractGlobBaseDirectory('/etc/passwd', 'linux'), { baseDir: '/etc', relativePattern: 'passwd' })
  // root glob
  assert.deepEqual(extractGlobBaseDirectory('/*.txt', 'linux'), { baseDir: '/', relativePattern: '*.txt' })
  // Windows drive root normalization is platform-gated
  assert.deepEqual(extractGlobBaseDirectory('C:/*.txt', 'windows'), { baseDir: 'C:/', relativePattern: '*.txt' })
  assert.deepEqual(extractGlobBaseDirectory('C:/*.txt', 'linux'), { baseDir: 'C:', relativePattern: '*.txt' })
})
