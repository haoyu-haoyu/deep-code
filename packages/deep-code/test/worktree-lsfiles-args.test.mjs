import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildIgnoredLsFilesArgs } from '../src/utils/worktreeLsFilesArgs.mjs'

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
