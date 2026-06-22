import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitGlobPatterns } from '../src/tools/GrepTool/splitGlobPatterns.mjs'

// The exact pre-fix split, as a differential oracle.
function oldSplit(glob) {
  const globPatterns = []
  for (const rawPattern of glob.split(/\s+/)) {
    if (rawPattern.includes('{') && rawPattern.includes('}')) {
      globPatterns.push(rawPattern)
    } else {
      globPatterns.push(...rawPattern.split(',').filter(Boolean))
    }
  }
  return globPatterns.filter(Boolean)
}

test('THE FIX: a mixed brace+comma token splits into valid globs', () => {
  assert.deepEqual(splitGlobPatterns('*.{ts,tsx},*.js'), ['*.{ts,tsx}', '*.js'])
  // Old behavior glued it into one invalid glob:
  assert.deepEqual(oldSplit('*.{ts,tsx},*.js'), ['*.{ts,tsx},*.js'])
  assert.notDeepEqual(
    splitGlobPatterns('*.{ts,tsx},*.js'),
    oldSplit('*.{ts,tsx},*.js'),
  )
})

test('two brace patterns comma-joined split correctly', () => {
  assert.deepEqual(splitGlobPatterns('{a,b}.ts,{c,d}.js'), ['{a,b}.ts', '{c,d}.js'])
})

test('nested braces are preserved, depth-0 comma still splits', () => {
  assert.deepEqual(splitGlobPatterns('a/{x,y}/*.{ts,js},b.txt'), [
    'a/{x,y}/*.{ts,js}',
    'b.txt',
  ])
})

test('currently-working pure forms are unchanged (parity with old split)', () => {
  for (const input of [
    '*.js',
    '*.js,*.ts',
    '*.{ts,tsx}',
    '*.ts *.tsx',
    '**/*.test.ts',
  ]) {
    assert.deepEqual(splitGlobPatterns(input), oldSplit(input), input)
  }
})

test('whitespace and stray separators are dropped', () => {
  assert.deepEqual(splitGlobPatterns('  *.ts ,  *.js  '), ['*.ts', '*.js'])
  assert.deepEqual(splitGlobPatterns(''), [])
  assert.deepEqual(splitGlobPatterns('   '), [])
})

test('unmatched braces are kept whole (malformed input, like the old split)', () => {
  assert.deepEqual(splitGlobPatterns('*.{ts'), ['*.{ts'])
  // a stray closing brace behaves like a literal: depth-0 comma still splits
  assert.deepEqual(splitGlobPatterns('a}b,c'), ['a}b', 'c'])
})

// End-to-end against the actual vendored ripgrep, when present (arch-specific
// path, so skipped rather than failed on machines/CI without the local binary).
const VENDORED_RG = join(
  process.cwd(),
  'vendor',
  'ripgrep',
  'arm64-darwin',
  'rg',
)

test('live ripgrep: the split mixed glob matches all intended files; the old glued glob matched nothing', { skip: !existsSync(VENDORED_RG) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'grep-split-glob-'))
  try {
    for (const f of ['a.ts', 'b.tsx', 'c.js', 'd.txt']) {
      writeFileSync(join(dir, f), 'x')
    }
    const runFiles = globArgs => {
      let out = ''
      try {
        out = execFileSync(
          VENDORED_RG,
          ['--files', '--no-ignore', ...globArgs.flatMap(g => ['--glob', g])],
          { cwd: dir, encoding: 'utf8' },
        )
      } catch (err) {
        out = err.stdout ? String(err.stdout) : ''
      }
      return out.split('\n').map(s => s.trim()).filter(Boolean).sort()
    }

    const fixed = runFiles(splitGlobPatterns('*.{ts,tsx},*.js'))
    assert.deepEqual(fixed, ['a.ts', 'b.tsx', 'c.js'])

    const glued = runFiles(oldSplit('*.{ts,tsx},*.js')) // single invalid glob
    assert.deepEqual(glued, []) // matched nothing -> the *.js filter was lost
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
