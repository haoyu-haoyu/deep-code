import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  gitDiffHunksArgs,
  gitDiffNumstatArgs,
  gitDiffShortstatArgs,
} from '../src/utils/gitDiffArgs.mjs'

// --- argv shape: quotepath prepended before the subcommand; --no-renames where it matters ---

test('the quotepath override precedes the diff subcommand on all three spawns', () => {
  for (const args of [gitDiffShortstatArgs, gitDiffNumstatArgs, gitDiffHunksArgs]) {
    assert.deepEqual(args.slice(0, 2), ['-c', 'core.quotepath=false'])
    assert.ok(
      args.indexOf('core.quotepath=false') < args.indexOf('diff'),
      'the -c override must come before the `diff` subcommand',
    )
    assert.equal(args[2], '--no-optional-locks')
    assert.equal(args[3], 'diff')
    assert.equal(args[4], 'HEAD')
  }
})

test('--no-renames is on numstat + full-diff but NOT shortstat (which has no per-file paths)', () => {
  assert.ok(gitDiffNumstatArgs.includes('--no-renames'))
  assert.ok(gitDiffNumstatArgs.includes('--numstat'))
  assert.ok(gitDiffHunksArgs.includes('--no-renames'))
  // shortstat keeps quotepath (uniform, a no-op there) but never --no-renames
  // (it would change the files-changed total).
  assert.ok(!gitDiffShortstatArgs.includes('--no-renames'))
  assert.ok(gitDiffShortstatArgs.includes('--shortstat'))
})

test('the args arrays are frozen (shared constants must not be mutated by a caller)', () => {
  assert.ok(Object.isFrozen(gitDiffNumstatArgs))
})

// --- real-git proof of both fixes (skips cleanly if git is unavailable) ---

function gitAvailable() {
  try {
    return execFileSync('git', ['--version'], { encoding: 'utf8' }).startsWith(
      'git version',
    )
  } catch {
    return false
  }
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gitdiff-args-'))
  const run = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  run('config', 'commit.gpgsign', 'false')
  return { dir, run }
}

test('quotepath: a modified non-ASCII filename is emitted raw, not C-quoted (numstat + diff header)', () => {
  if (!gitAvailable()) return
  const { dir, run } = initRepo()
  try {
    // CJK filename committed, then modified.
    writeFileSync(join(dir, '配置.txt'), 'one\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    writeFileSync(join(dir, '配置.txt'), 'one\ntwo\n')

    // Default git C-quotes the high bytes:
    const defaultNumstat = execFileSync(
      'git',
      ['--no-optional-locks', 'diff', 'HEAD', '--numstat'],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.ok(
      defaultNumstat.includes('\\351') && defaultNumstat.includes('"'),
      `default numstat should be C-quoted, got: ${JSON.stringify(defaultNumstat)}`,
    )

    // With our args the path is raw UTF-8 and the numstat key === the diff header path.
    const numstat = execFileSync('git', [...gitDiffNumstatArgs], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.ok(numstat.includes('配置.txt'), `numstat raw path, got: ${JSON.stringify(numstat)}`)
    assert.ok(!numstat.includes('\\351'), 'numstat must not be C-quoted')

    const diff = execFileSync('git', [...gitDiffHunksArgs], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.ok(
      diff.includes('a/配置.txt b/配置.txt'),
      `diff header must be raw + parseable by /^a\\/(.+?) b\\/(.+)$/, got: ${JSON.stringify(diff.split('\n')[0])}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--no-renames: a rename+edit is a split delete+add (numstat key === diff header key)', () => {
  if (!gitAvailable()) return
  const { dir, run } = initRepo()
  try {
    writeFileSync(join(dir, 'original.txt'), 'a\nb\nc\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    run('mv', 'original.txt', 'renamed.txt')
    writeFileSync(join(dir, 'renamed.txt'), 'a\nb\nc\nd\n')

    // Default git (rename detection on) collapses to a single `old => new` entry:
    const defaultNumstat = execFileSync(
      'git',
      ['--no-optional-locks', 'diff', 'HEAD', '--numstat'],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.ok(
      defaultNumstat.includes('=>'),
      `default numstat should combine the rename, got: ${JSON.stringify(defaultNumstat)}`,
    )

    // With --no-renames there is no `=>` combined key; the file appears as a
    // deletion of original.txt and an addition of renamed.txt.
    const numstat = execFileSync('git', [...gitDiffNumstatArgs], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.ok(!numstat.includes('=>'), `no combined rename key, got: ${JSON.stringify(numstat)}`)
    assert.ok(numstat.includes('original.txt'))
    assert.ok(numstat.includes('renamed.txt'))

    // The diff header keys (destination path) match the numstat keys: every
    // `diff --git a/X b/Y` here has X === Y (no a/original.txt b/renamed.txt).
    const diff = execFileSync('git', [...gitDiffHunksArgs], {
      cwd: dir,
      encoding: 'utf8',
    })
    const headers = diff
      .split('\n')
      .filter(l => l.startsWith('diff --git '))
      .map(l => l.slice('diff --git '.length))
    assert.ok(headers.length >= 1)
    for (const h of headers) {
      const m = h.match(/^a\/(.+?) b\/(.+)$/)
      assert.ok(m, `header must parse: ${JSON.stringify(h)}`)
      assert.equal(m[1], m[2], `rename must be split, not combined: ${JSON.stringify(h)}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
