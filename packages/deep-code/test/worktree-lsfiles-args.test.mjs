import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildIgnoredLsFilesArgs } from '../src/utils/worktreeLsFilesArgs.mjs'
import { isStaleWorktreeRegistrationError } from '../src/utils/worktreeAddError.mjs'

test('buildIgnoredLsFilesArgs prepends core.quotepath=false before ls-files', () => {
  const args = buildIgnoredLsFilesArgs()
  // The `-c key=value` override MUST precede the `ls-files` subcommand or git
  // treats it as a pathspec and the quoting is never disabled.
  assert.deepEqual(args.slice(0, 3), ['-c', 'core.quotepath=false', 'ls-files'])
  assert.ok(
    args.indexOf('core.quotepath=false') < args.indexOf('ls-files'),
    'the override must come before the subcommand',
  )
  assert.deepEqual(args.slice(3), [
    '--others',
    '--ignored',
    '--exclude-standard',
  ])
})

test('buildIgnoredLsFilesArgs appends caller extras (both call sites)', () => {
  assert.deepEqual(buildIgnoredLsFilesArgs(['--directory']).at(-1), '--directory')
  const scoped = buildIgnoredLsFilesArgs(['--', 'a/', 'b/'])
  assert.deepEqual(scoped.slice(-3), ['--', 'a/', 'b/'])
  // The override survives no matter what extras are appended.
  assert.ok(scoped.includes('core.quotepath=false'))
})

test('the override makes git emit raw UTF-8 for a non-ASCII gitignored path', () => {
  // Empirical proof of the fix: with git's default core.quotePath=true a
  // non-ASCII path is C-quoted (`"\351\205\215..."`), so the downstream
  // newline-split + .worktreeinclude match never sees the real name and the file
  // is silently not copied. buildIgnoredLsFilesArgs must yield raw bytes instead.
  let git
  try {
    git = execFileSync('git', ['--version'], { encoding: 'utf8' })
  } catch {
    return // git not available in this environment; the unit tests above suffice
  }
  assert.ok(git.startsWith('git version'))

  const dir = mkdtempSync(join(tmpdir(), 'wt-quotepath-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '*.env\n')
    // CJK filename: single NFC form, no NFD/NFC normalization ambiguity across OSes.
    writeFileSync(join(dir, '配置.env'), 'secret\n')

    const quoted = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard'],
      { cwd: dir, encoding: 'utf8' },
    )
    // Default git quotes the high bytes as octal escapes inside double quotes.
    assert.ok(
      quoted.includes('\\351') && quoted.includes('"'),
      `default git output should be C-quoted, got: ${JSON.stringify(quoted)}`,
    )

    const raw = execFileSync('git', buildIgnoredLsFilesArgs(), {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.ok(
      raw.includes('配置.env'),
      `quotepath=false output should contain the raw path, got: ${JSON.stringify(raw)}`,
    )
    assert.ok(
      !raw.includes('\\351'),
      'quotepath=false output must not be C-quoted',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- isStaleWorktreeRegistrationError: classify a recoverable `git worktree add`
// failure (a stale registration that `git worktree prune` can clear) ---

test('isStaleWorktreeRegistrationError matches the two stale-registration fatals, not "already exists"', () => {
  // dir-gone-but-registered (the primary case getOrCreateWorktree hits)
  assert.equal(
    isStaleWorktreeRegistrationError(
      "fatal: '../wt-a' is a missing but already registered worktree;\nuse 'add -f' to override, or 'prune' or 'remove' to clear",
    ),
    true,
  )
  // branch held by a (possibly stale) worktree
  assert.equal(
    isStaleWorktreeRegistrationError(
      "fatal: 'feat' is already used by worktree at '/tmp/wt-probe/wt-a'",
    ),
    true,
  )
  // NOT recoverable by prune — a real directory is present (must not auto-delete)
  assert.equal(
    isStaleWorktreeRegistrationError("fatal: '/tmp/x' already exists"),
    false,
  )
  // unrelated failures pass through to a plain throw
  assert.equal(isStaleWorktreeRegistrationError('fatal: invalid reference: main'), false)
  assert.equal(isStaleWorktreeRegistrationError('fatal: not a git repository'), false)
  assert.equal(isStaleWorktreeRegistrationError(''), false)
  assert.equal(isStaleWorktreeRegistrationError(undefined), false)
  assert.equal(isStaleWorktreeRegistrationError(null), false)
})

test('isStaleWorktreeRegistrationError tracks REAL git output for a dir-gone worktree, and prune+retry recovers', () => {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-wt-stale-'))
  const repo = join(root, 'repo')
  const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' })
    git(['config', 'user.email', 't@t'], repo)
    git(['config', 'user.name', 't'], repo)
    git(['commit', '-q', '--allow-empty', '-m', 'init'], repo)
    const wtPath = join(root, 'wt-a')
    git(['worktree', 'add', '-q', wtPath, '-b', 'feat'], repo)

    // Remove the worktree DIRECTORY out-of-band, leaving the git registration.
    rmSync(wtPath, { recursive: true, force: true })

    // Re-creating at the SAME path now fatals with exit 128 — capture the stderr.
    let createStderr = ''
    try {
      execFileSync('git', ['worktree', 'add', '-B', 'feat2', wtPath, 'main'], {
        cwd: repo,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      })
      assert.fail('expected the stale-registration add to fail')
    } catch (e) {
      createStderr = String(e.stderr ?? '')
    }
    // The classifier must recognize the LIVE git phrasing (guards a git wording drift).
    assert.equal(
      isStaleWorktreeRegistrationError(createStderr),
      true,
      `classifier missed real git stderr: ${JSON.stringify(createStderr)}`,
    )

    // prune + retry the SAME add recovers (the fix).
    git(['worktree', 'prune'], repo)
    git(['worktree', 'add', '-B', 'feat2', wtPath, 'main'], repo) // throws if it fails
    assert.ok(true, 'prune+retry succeeded')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
