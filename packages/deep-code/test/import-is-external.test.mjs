import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  importIsExternal,
  symlinkEscapesProject,
} from '../src/utils/importIsExternal.mjs'

// A stand-in for pathInOriginalCwd: inside the project iff under /project.
const isInsideProject = p => p === '/project' || p.startsWith('/project/')

test('a plain in-project import is not external', () => {
  // lexical in-project, realpath identical (regular file)
  assert.equal(
    importIsExternal('/project/rules.md', '/project/rules.md', isInsideProject),
    false,
  )
})

test('an in-project symlink to an in-project target is not external', () => {
  assert.equal(
    importIsExternal('/project/link.md', '/project/shared/rules.md', isInsideProject),
    false,
  )
})

test('THE FIX: an in-project symlink whose real target escapes the project is external', () => {
  // link.md is lexically in-project (old check passed), but resolves to /etc/passwd.
  assert.equal(
    importIsExternal('/project/link.md', '/etc/passwd', isInsideProject),
    true,
  )
})

test('a lexically-external import stays external (prior behavior preserved)', () => {
  // A direct ../ traversal: lexical path already outside the project.
  assert.equal(
    importIsExternal('/etc/passwd', '/etc/passwd', isInsideProject),
    true,
  )
  assert.equal(
    importIsExternal('/outside/x.md', '/outside/x.md', isInsideProject),
    true,
  )
})

test('a broken symlink (resolvedRealPath == lexicalPath) degrades to the lexical check', () => {
  // safeResolvePath returns the original path on ENOENT/broken-symlink/EACCES.
  assert.equal(
    importIsExternal('/project/broken.md', '/project/broken.md', isInsideProject),
    false,
  )
})

test('a falsy resolvedRealPath falls back to the lexical check (no crash)', () => {
  assert.equal(importIsExternal('/project/a.md', '', isInsideProject), false)
  assert.equal(importIsExternal('/project/a.md', undefined, isInsideProject), false)
  assert.equal(importIsExternal('/outside/a.md', undefined, isInsideProject), true)
})

test('the lexical check runs first: an external lexical path is external even if real path is in-project', () => {
  // Defensive: if somehow the lexical path is outside but realpath is inside,
  // the import is still treated as external (lexical gate is authoritative).
  assert.equal(
    importIsExternal('/outside/link.md', '/project/real.md', isInsideProject),
    true,
  )
})

// symlinkEscapesProject — the narrower predicate for a directly-discovered file
// (top-level DEEPCODE.md / rules entry). It must catch the in-project symlink
// that escapes, but must NOT flag a legitimately-external file (User/Managed/
// --add-dir) whose lexical path is already outside the project.

test('symlinkEscapesProject: THE FIX — an in-project file symlinked to /etc/passwd escapes', () => {
  assert.equal(
    symlinkEscapesProject('/project/DEEPCODE.md', '/etc/passwd', isInsideProject),
    true,
  )
  // a rules entry symlinked out
  assert.equal(
    symlinkEscapesProject('/project/.deepcode/rules/x.md', '/etc/shadow', isInsideProject),
    true,
  )
})

test('symlinkEscapesProject: a normal in-project file does not escape', () => {
  assert.equal(
    symlinkEscapesProject('/project/DEEPCODE.md', '/project/DEEPCODE.md', isInsideProject),
    false,
  )
  // an in-project symlink to another in-project file
  assert.equal(
    symlinkEscapesProject('/project/link.md', '/project/real.md', isInsideProject),
    false,
  )
})

test('symlinkEscapesProject: NO REGRESSION for legitimately-external files (--add-dir / User / Managed)', () => {
  // A --add-dir DEEPCODE.md, or ~/.deepcode User memory, or the managed dir —
  // lexical path already outside cwd. These load on purpose and must NOT be
  // flagged as a symlink escape (that would skip a legitimate file).
  assert.equal(
    symlinkEscapesProject('/other/added-dir/DEEPCODE.md', '/other/added-dir/DEEPCODE.md', isInsideProject),
    false,
  )
  assert.equal(
    symlinkEscapesProject('/home/me/.deepcode/DEEPCODE.md', '/home/me/.deepcode/DEEPCODE.md', isInsideProject),
    false,
  )
  // even if such an external file is itself a symlink to elsewhere-external,
  // it's not OUR project's boundary being escaped — lexical already external.
  assert.equal(
    symlinkEscapesProject('/home/me/.deepcode/DEEPCODE.md', '/etc/passwd', isInsideProject),
    false,
  )
})

test('symlinkEscapesProject: broken/falsy resolved path does not flag', () => {
  assert.equal(
    symlinkEscapesProject('/project/broken.md', '/project/broken.md', isInsideProject),
    false,
  )
  assert.equal(symlinkEscapesProject('/project/a.md', '', isInsideProject), false)
  assert.equal(symlinkEscapesProject('/project/a.md', undefined, isInsideProject), false)
})

test('importIsExternal still composes symlinkEscapesProject (behavior unchanged)', () => {
  // lexical-external OR symlink-escape
  assert.equal(importIsExternal('/etc/passwd', '/etc/passwd', isInsideProject), true)
  assert.equal(importIsExternal('/project/link.md', '/etc/passwd', isInsideProject), true)
  assert.equal(importIsExternal('/project/ok.md', '/project/ok.md', isInsideProject), false)
})
