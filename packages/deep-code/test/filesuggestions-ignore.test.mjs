import assert from 'node:assert/strict'
import { test } from 'node:test'

import ignore from 'ignore'

import { filterIgnoredGitPaths } from '../src/hooks/fileSuggestionsIgnore.mjs'

test('filterIgnoredGitPaths drops ignored repoRoot-relative paths', () => {
  const ig = ignore().add('*.md\nbuild/\n')
  const raw = ['README.md', 'src/x.ts', 'docs/y.md', 'build/out.js', 'src/z.ts']
  assert.deepEqual(filterIgnoredGitPaths(raw, ig), ['src/x.ts', 'src/z.ts'])
})

test('filterIgnoredGitPaths returns the list unchanged when there is no ignore instance', () => {
  const raw = ['a.ts', 'b.ts']
  assert.equal(filterIgnoredGitPaths(raw, null), raw) // same reference, no copy
  assert.equal(filterIgnoredGitPaths(raw, undefined), raw)
})

test('filterIgnoredGitPaths never throws — guards the "../"-prefixed paths the ignore lib rejects', () => {
  // The `ignore` library throws a RangeError on a path that is not a clean
  // path.relative()'d string (any leading "../"). That is exactly the shape the
  // OLD code produced by normalizing to cwd from a subdirectory, which crashed
  // the git fast path. Prove (a) the raw library still throws on such input, and
  // (b) the leaf swallows it and returns the list unfiltered rather than crash.
  const ig = ignore().add('*.md')
  const escaping = ['../../README.md', '../sibling/x.ts', 'index.ts']
  assert.throws(() => ig.filter(escaping), { name: 'RangeError' })
  assert.deepEqual(filterIgnoredGitPaths(escaping, ig), escaping)
})

test('filterIgnoredGitPaths handles an empty list', () => {
  assert.deepEqual(filterIgnoredGitPaths([], ignore().add('*.md')), [])
})
