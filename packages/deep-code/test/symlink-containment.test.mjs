import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'

import { isSymlinkTargetContained } from '../src/utils/plugins/symlinkContainment.mjs'

const SRC = `${sep}home${sep}u${sep}.deepcode${sep}plugins${sep}cache${sep}myplugin`

test('an in-tree symlink target is contained', () => {
  assert.equal(isSymlinkTargetContained(`${SRC}${sep}skills${sep}a.md`, SRC), true)
  assert.equal(isSymlinkTargetContained(`${SRC}${sep}nested${sep}deep${sep}f`, SRC), true)
  assert.equal(isSymlinkTargetContained(SRC, SRC), true) // the root itself
})

test('THE FIX: an out-of-tree symlink target is NOT contained', () => {
  assert.equal(isSymlinkTargetContained(`${sep}home${sep}u${sep}.ssh${sep}id_rsa`, SRC), false)
  assert.equal(isSymlinkTargetContained(`${sep}etc${sep}passwd`, SRC), false)
  // a sibling dir that shares a prefix string but is NOT inside (no separator boundary)
  assert.equal(isSymlinkTargetContained(`${SRC}-evil${sep}x`, SRC), false)
  assert.equal(isSymlinkTargetContained(`${SRC}-evil`, SRC), false)
})

test('the prefix match respects the path separator boundary', () => {
  // `${SRC}x` must not count as inside `${SRC}` even though it startsWith the string
  assert.equal(isSymlinkTargetContained(`${SRC}x`, SRC), false)
  // a trailing-separator src is handled
  assert.equal(isSymlinkTargetContained(`${SRC}${sep}a`, `${SRC}${sep}`), true)
})

test('non-string / empty inputs are not contained (skip → safe)', () => {
  assert.equal(isSymlinkTargetContained(undefined, SRC), false)
  assert.equal(isSymlinkTargetContained(SRC, undefined), false)
  assert.equal(isSymlinkTargetContained(`${SRC}${sep}a`, ''), false)
  assert.equal(isSymlinkTargetContained(null, null), false)
})
