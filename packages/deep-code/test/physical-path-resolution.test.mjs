import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasParentTraversalSegment,
  resolvePhysicalLanding,
} from '../src/utils/permissions/physicalPathResolution.mjs'

test('hasParentTraversalSegment: flags a `..` path segment, not `..` inside a name', () => {
  for (const p of ['../x', 'a/../b', 'a/..', '..', 'link/../escaped', '/abs/../y']) {
    assert.equal(hasParentTraversalSegment(p), true, p)
  }
  for (const p of ['a..b', '..foo', 'foo..', 'a/b/c', 'file.txt', './x', 'a/.../b']) {
    assert.equal(hasParentTraversalSegment(p), false, p)
  }
})

// Mock fs: `symlinks` map physical->target (one canonical hop); `dirs` are real
// directories; anything else is non-existent (isCanonical:false). The leaf only
// ever calls resolveOneLevel on join(physicalAccumulator, part), so the only
// unresolved component is the last one — matching safeResolvePath's contract.
function makeResolver(symlinks, dirs) {
  return candidate => {
    if (candidate in symlinks)
      return { resolvedPath: symlinks[candidate], isCanonical: true }
    if (dirs.has(candidate))
      return { resolvedPath: candidate, isCanonical: true }
    return { resolvedPath: candidate, isCanonical: false }
  }
}

// cwd=/p/cwd, link -> /p/external (escapes cwd), inlink -> /p/cwd/inner (stays),
// realdir is a real in-cwd dir.
const resolver = makeResolver(
  {
    '/p/cwd/link': '/p/external',
    '/p/cwd/inlink': '/p/cwd/inner',
  },
  // existing real dirs (incl. ancestors, so an absolute walk from / continues
  // past the existing prefix the way realpath does)
  new Set(['/', '/p', '/p/cwd', '/p/cwd/realdir', '/p/cwd/inner', '/p/external']),
)
const land = p => resolvePhysicalLanding('/p/cwd', p, resolver)

test('SECURITY: `..` after a symlink resolves PHYSICALLY (escapes), not lexically', () => {
  // link -> /p/external, so link/.. is /p (the parent of external), NOT /p/cwd.
  assert.equal(land('link/../escaped.txt'), '/p/escaped.txt')
  assert.equal(land('link/../../etc/x'), '/etc/x')
  assert.equal(land('link/../sub/x.txt'), '/p/sub/x.txt')
})

test('a symlink whose target stays inside cwd resolves back into cwd (no over-block)', () => {
  // inlink -> /p/cwd/inner, so inlink/.. is /p/cwd -> in-cwd.
  assert.equal(land('inlink/../foo.txt'), '/p/cwd/foo.txt')
})

test('a real (non-symlink) directory with `..` collapses normally, staying in cwd', () => {
  assert.equal(land('realdir/../foo.txt'), '/p/cwd/foo.txt')
  assert.equal(land('realdir/sub/../../foo.txt'), '/p/cwd/foo.txt')
})

test('a plain leading `..` escapes to the real parent', () => {
  assert.equal(land('../escaped.txt'), '/p/escaped.txt')
  assert.equal(land('../../escaped.txt'), '/escaped.txt')
})

test('a symlink with NO `..` lands at its target (caller still confines it)', () => {
  assert.equal(land('link/inside.txt'), '/p/external/inside.txt')
})

test('`.` and empty segments are ignored', () => {
  assert.equal(land('./realdir/./../foo.txt'), '/p/cwd/foo.txt')
  assert.equal(land('realdir//..//foo.txt'), '/p/cwd/foo.txt')
})

test('`..` clamps at the filesystem root (cannot go above /)', () => {
  assert.equal(land('../../../../../../etc/x'), '/etc/x')
})

test('absolute input with a `..` after a symlink resolves physically', () => {
  // Absolute paths start from the root and walk every component.
  assert.equal(land('/p/cwd/link/../abs.txt'), '/p/abs.txt')
  assert.equal(land('/p/cwd/realdir/../abs.txt'), '/p/cwd/abs.txt')
})

test('once a component does not exist, the tail is appended (no symlinks possible)', () => {
  // `nope` does not exist; `..` after it is lexical (a non-existent dir has no symlink).
  assert.equal(land('nope/../foo.txt'), '/p/cwd/foo.txt')
})
