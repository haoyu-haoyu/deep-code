import assert from 'node:assert/strict'
import { test } from 'node:test'

import { filterIgnoredGitPaths } from '../src/hooks/fileSuggestionsIgnore.mjs'

// A minimal stand-in for an `ignore` instance: it exposes the only method the
// leaf uses, `.filter(paths)`. The real `ignore` library is a vendored,
// UNDECLARED dependency (not in package.json), so `npm ci` on CI does not
// install it and importing it from a test fails with ERR_MODULE_NOT_FOUND. The
// leaf never imports it either — it receives the instance as a parameter — so
// the unit under test is fully exercised with a stub, and the real library's
// RangeError-on-"../" behaviour (the whole reason the guard exists) is
// reproduced faithfully by the throwing stub below.
function stubIgnore(keep) {
  return { filter: paths => paths.filter(keep) }
}

test('filterIgnoredGitPaths drops the paths the ignore instance rejects', () => {
  const ig = stubIgnore(p => !p.endsWith('.md') && !p.startsWith('build/'))
  const raw = ['README.md', 'src/x.ts', 'docs/y.md', 'build/out.js', 'src/z.ts']
  assert.deepEqual(filterIgnoredGitPaths(raw, ig), ['src/x.ts', 'src/z.ts'])
})

test('filterIgnoredGitPaths returns the list unchanged when there is no ignore instance', () => {
  const raw = ['a.ts', 'b.ts']
  assert.equal(filterIgnoredGitPaths(raw, null), raw) // same reference, no copy
  assert.equal(filterIgnoredGitPaths(raw, undefined), raw)
})

test('filterIgnoredGitPaths never throws — guards a filter() that rejects "../"-prefixed paths', () => {
  // The real `ignore` library throws a RangeError on any '../'-prefixed path
  // ("path should be a `path.relative()`d string") — exactly the shape the OLD
  // cwd-relative normalization produced from a subdirectory launch, which
  // crashed the git fast path. The leaf must swallow ANY throw and return the
  // list unfiltered rather than let the crash propagate.
  const throwingIg = {
    filter(paths) {
      for (const p of paths) {
        if (p.startsWith('../')) {
          throw new RangeError('path should be a `path.relative()`d string')
        }
      }
      return paths
    },
  }
  const escaping = ['../../README.md', '../sibling/x.ts', 'index.ts']
  assert.throws(() => throwingIg.filter(escaping), { name: 'RangeError' })
  assert.deepEqual(filterIgnoredGitPaths(escaping, throwingIg), escaping)
})

test('filterIgnoredGitPaths handles an empty list', () => {
  assert.deepEqual(filterIgnoredGitPaths([], stubIgnore(() => true)), [])
})
