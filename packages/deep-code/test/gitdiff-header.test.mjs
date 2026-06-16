import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { gitDiffHunksArgs } from '../src/utils/gitDiffArgs.mjs'
import { extractDiffFilePath } from '../src/utils/gitDiffHeader.mjs'

// --- unit: prefer the single-path +++ b/ / --- a/ lines ---

test('a modified file resolves to the +++ b/ path', () => {
  const lines = [
    'a/foo.txt b/foo.txt',
    'index e69de29..0cfbf08 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -0,0 +1 @@',
    '+hi',
  ]
  assert.equal(extractDiffFilePath(lines), 'foo.txt')
})

test('a path containing a literal " b/" substring is NOT mis-split (the bug)', () => {
  // dir named "a b" → header `a/a b/c.txt b/a b/c.txt`; the old regex split at
  // the FIRST " b/" → wrong key "c.txt b/a b/c.txt". The +++ b/ line is exact.
  const lines = [
    'a/a b/c.txt b/a b/c.txt',
    'index 1..2 100644',
    '--- a/a b/c.txt',
    '+++ b/a b/c.txt',
    '@@ -1 +1 @@',
    '-x',
    '+y',
  ]
  assert.equal(extractDiffFilePath(lines), 'a b/c.txt')
  // prove the old regex really did mis-split (regression guard)
  const old = lines[0].match(/^a\/(.+?) b\/(.+)$/)
  assert.equal(old?.[2], 'c.txt b/a b/c.txt') // the old wrong key
  assert.notEqual(old?.[2], 'a b/c.txt')
})

test('a new file uses +++ b/ (--- is /dev/null)', () => {
  const lines = [
    'a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+content',
  ]
  assert.equal(extractDiffFilePath(lines), 'new.txt')
})

test('a deleted file uses --- a/ (+++ is /dev/null)', () => {
  const lines = [
    'a/del.txt b/del.txt',
    'deleted file mode 100644',
    '--- a/del.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
  ]
  assert.equal(extractDiffFilePath(lines), 'del.txt')
})

test('a mode-only diff (no +++/--- lines) falls back to the header regex', () => {
  const lines = ['a/x.sh b/x.sh', 'old mode 100644', 'new mode 100755']
  assert.equal(extractDiffFilePath(lines), 'x.sh')
})

test('a binary diff (no +++/--- lines) falls back to the header regex', () => {
  const lines = [
    'a/img.png b/img.png',
    'index 1..2 100644',
    'Binary files a/img.png and b/img.png differ',
  ]
  assert.equal(extractDiffFilePath(lines), 'img.png')
})

test('the scan stops at the first @@ (a hunk body line cannot shadow the header)', () => {
  const lines = [
    'a/r.txt b/r.txt',
    '--- a/r.txt',
    '+++ b/r.txt',
    '@@ -1 +1 @@',
    '+++ b/not-a-real-path', // an added line that looks like a header
  ]
  assert.equal(extractDiffFilePath(lines), 'r.txt')
})

test('a trailing TAB on a spaced path is stripped', () => {
  const lines = [
    'a/has space.txt b/has space.txt',
    '--- a/has space.txt\t',
    '+++ b/has space.txt\t',
    '@@ -1 +1 @@',
  ]
  assert.equal(extractDiffFilePath(lines), 'has space.txt')
})

test('no parseable header returns null', () => {
  assert.equal(extractDiffFilePath(['garbage', 'more garbage']), null)
})

// --- real-git proof: a dir named "a b" no longer mis-keys (skips if git absent) ---

test('real git: modifying a file under a dir named "a b" keys it correctly', () => {
  let ok = false
  try {
    ok = execFileSync('git', ['--version'], { encoding: 'utf8' }).startsWith('git version')
  } catch {
    return
  }
  if (!ok) return
  const dir = mkdtempSync(join(tmpdir(), 'gitdiff-header-'))
  const run = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  try {
    run('init', '-q')
    run('config', 'user.email', 't@e.com')
    run('config', 'user.name', 'T')
    run('config', 'commit.gpgsign', 'false')
    mkdirSync(join(dir, 'a b'))
    writeFileSync(join(dir, 'a b', 'c.txt'), 'one\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    writeFileSync(join(dir, 'a b', 'c.txt'), 'one\ntwo\n')

    const diff = execFileSync('git', [...gitDiffHunksArgs], { cwd: dir, encoding: 'utf8' })
    // mirror parseGitDiff: split into file-diffs, take the first, extract the path
    const fileDiff = diff.split(/^diff --git /m).filter(Boolean)[0]
    const path = extractDiffFilePath(fileDiff.split('\n'))
    assert.equal(path, 'a b/c.txt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
