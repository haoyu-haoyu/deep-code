import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  markdownFileEscapesProject,
  filterProjectEscapingMarkdownFiles,
} from '../src/utils/markdownSymlinkContainment.mjs'

// Model a project rooted at /proj. isInsideProject mirrors pathInOriginalCwd.
const PROJ = '/proj'
const isInsideProject = p => p === PROJ || p.startsWith(PROJ + '/')

// resolveRealPath stub: a small symlink table; unknown paths resolve to
// themselves (safeResolvePath returns the lexical path unchanged on failure /
// for non-symlinks).
function makeResolver(links) {
  return p => links[p] ?? p
}

test('in-project file symlinking OUTSIDE the project is flagged/dropped', () => {
  const resolve = makeResolver({
    '/proj/.deepcode/commands/notes.md': '/home/user/.ssh/id_rsa',
  })
  assert.equal(
    markdownFileEscapesProject(
      '/proj/.deepcode/commands/notes.md',
      resolve,
      isInsideProject,
    ),
    true,
  )
})

test('a plain in-project file (not a symlink) is kept', () => {
  const resolve = makeResolver({}) // resolves to itself
  assert.equal(
    markdownFileEscapesProject(
      '/proj/.deepcode/commands/deploy.md',
      resolve,
      isInsideProject,
    ),
    false,
  )
})

test('a within-project symlink (target still inside the project) is kept', () => {
  const resolve = makeResolver({
    '/proj/.deepcode/commands/shared.md': '/proj/shared/deploy.md',
  })
  assert.equal(
    markdownFileEscapesProject(
      '/proj/.deepcode/commands/shared.md',
      resolve,
      isInsideProject,
    ),
    false,
  )
})

test('a file whose LEXICAL path is already outside the project is NOT flagged (user/managed/ancestor dirs)', () => {
  // ~/.claude command pointing wherever — loaded intentionally, never our concern.
  const resolve = makeResolver({
    '/home/user/.claude/commands/x.md': '/etc/passwd',
  })
  assert.equal(
    markdownFileEscapesProject(
      '/home/user/.claude/commands/x.md',
      resolve,
      isInsideProject,
    ),
    false,
  )
  // The classic legitimate case: ~/.claude symlinked into the project hierarchy.
  // Lexical path is ~/.claude (outside project) -> not flagged even though the
  // real path is in-project.
  const resolve2 = makeResolver({
    '/home/user/.claude/commands/y.md': '/proj/shared/y.md',
  })
  assert.equal(
    markdownFileEscapesProject(
      '/home/user/.claude/commands/y.md',
      resolve2,
      isInsideProject,
    ),
    false,
  )
})

test('a broken/unresolvable symlink resolves to its lexical path -> NOT flagged', () => {
  // safeResolvePath returns the lexical path unchanged on ENOENT/ELOOP, so
  // resolveRealPath(p) === p and the != lexical guard fails -> kept (the
  // subsequent readFile will simply fail and be skipped by the caller).
  const resolve = makeResolver({})
  assert.equal(
    markdownFileEscapesProject(
      '/proj/.deepcode/agents/broken.md',
      resolve,
      isInsideProject,
    ),
    false,
  )
})

test('filter drops only escaping files, preserves order, and reports skips', () => {
  const files = [
    '/proj/.deepcode/commands/a.md', // plain in-project -> keep
    '/proj/.deepcode/commands/escape.md', // -> /etc/shadow -> drop
    '/home/user/.claude/commands/u.md', // outside lexical -> keep
    '/proj/.deepcode/commands/b.md', // within-project symlink -> keep
  ]
  const resolve = makeResolver({
    '/proj/.deepcode/commands/escape.md': '/etc/shadow',
    '/proj/.deepcode/commands/b.md': '/proj/lib/b.md',
    '/home/user/.claude/commands/u.md': '/somewhere/else.md',
  })
  const skipped = []
  const kept = filterProjectEscapingMarkdownFiles(
    files,
    resolve,
    isInsideProject,
    p => skipped.push(p),
  )
  assert.deepEqual(kept, [
    '/proj/.deepcode/commands/a.md',
    '/home/user/.claude/commands/u.md',
    '/proj/.deepcode/commands/b.md',
  ])
  assert.deepEqual(skipped, ['/proj/.deepcode/commands/escape.md'])
})

test('filter works without an onSkip callback', () => {
  const kept = filterProjectEscapingMarkdownFiles(
    ['/proj/.deepcode/commands/escape.md'],
    makeResolver({ '/proj/.deepcode/commands/escape.md': '/etc/passwd' }),
    isInsideProject,
  )
  assert.deepEqual(kept, [])
})
