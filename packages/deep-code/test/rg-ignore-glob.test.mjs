import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rgIgnoreGlob } from '../src/utils/rgIgnoreGlob.mjs'

test('rooted patterns keep their anchor (just negated)', () => {
  assert.equal(rgIgnoreGlob('/config/secret.txt'), '!/config/secret.txt')
  assert.equal(rgIgnoreGlob('/.env'), '!/.env')
})

test('THE FIX: a relative slash-bearing pattern gets a double-star prefix so it matches at any depth', () => {
  // Before the fix GlobTool emitted `!config/secret.txt`, which ripgrep anchors at
  // the search root -> nested copies (sub/config/secret.txt) leaked. GrepTool
  // already did this; now both share the rule.
  assert.equal(rgIgnoreGlob('config/secret.txt'), '!**/config/secret.txt')
  assert.equal(rgIgnoreGlob('a/b/c.txt'), '!**/a/b/c.txt')
})

test('slash-less relative patterns are also prefixed (still match at any depth, parity with GrepTool)', () => {
  assert.equal(rgIgnoreGlob('.env'), '!**/.env')
  assert.equal(rgIgnoreGlob('secret.txt'), '!**/secret.txt')
})

test('the output differs from the old verbatim GlobTool form for the leaking case', () => {
  const pattern = 'config/secret.txt'
  const oldVerbatim = `!${pattern}` // what GlobTool used to emit
  assert.notEqual(rgIgnoreGlob(pattern), oldVerbatim)
})

// End-to-end proof against the actual vendored ripgrep, when present. The vendor
// path is arch-specific, so this is skipped on machines/CI without the local
// arm64-darwin binary rather than failing.
const VENDORED_RG = join(
  process.cwd(),
  'vendor',
  'ripgrep',
  'arm64-darwin',
  'rg',
)

test('live ripgrep: the fixed glob hides nested deny-protected copies, the old one leaked them', { skip: !existsSync(VENDORED_RG) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-ignore-glob-'))
  try {
    mkdirSync(join(dir, 'config'), { recursive: true })
    mkdirSync(join(dir, 'sub', 'config'), { recursive: true })
    writeFileSync(join(dir, 'config', 'secret.txt'), 'x')
    writeFileSync(join(dir, 'sub', 'config', 'secret.txt'), 'x')
    writeFileSync(join(dir, 'keep.txt'), 'x')

    const run = excludeGlob => {
      let out = ''
      try {
        out = execFileSync(
          VENDORED_RG,
          ['--files', '--hidden', '--no-ignore', '--glob', '*', '--glob', excludeGlob],
          { cwd: dir, encoding: 'utf8' },
        )
      } catch (err) {
        // rg exits non-zero when no files match; capture whatever it printed.
        out = err.stdout ? String(err.stdout) : ''
      }
      return out.split('\n').map(s => s.trim()).filter(Boolean).sort()
    }

    const fixed = run(rgIgnoreGlob('config/secret.txt')) // !**/config/secret.txt
    const old = run('!config/secret.txt') // the pre-fix verbatim form

    // The fix hides BOTH the root and nested copy; only keep.txt survives.
    assert.deepEqual(fixed, ['keep.txt'])
    // The old verbatim form anchored at root -> the nested copy leaked.
    assert.ok(old.includes('sub/config/secret.txt'))
    assert.ok(!fixed.includes('sub/config/secret.txt'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
