import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deleteOccurrences } from '../src/tools/FileEditTool/deleteOccurrences.mjs'

// The buggy implementation that shipped before this fix (the newString==='' branch
// of applyEditToFile): a single global `oldString + '\n'` search.
function oldDelete(content, oldString, replaceAll) {
  const f = replaceAll
    ? (c, s) => c.replaceAll(s, () => '')
    : (c, s) => c.replace(s, () => '')
  const stripTrailingNewline =
    !oldString.endsWith('\n') && content.includes(oldString + '\n')
  return stripTrailingNewline ? f(content, oldString + '\n') : f(content, oldString)
}

// An INDEPENDENT (split-based) implementation of the intended contract: remove
// each (or, single-mode, the first) non-overlapping occurrence, consuming one
// leading newline of the following segment when oldString isn't newline-terminated.
function refDelete(content, oldString, replaceAll) {
  if (oldString === '') return content
  const consume = !oldString.endsWith('\n')
  const parts = content.split(oldString)
  if (parts.length === 1) return content
  if (!replaceAll) {
    let tail = parts.slice(1).join(oldString)
    if (consume && tail.startsWith('\n')) tail = tail.slice(1)
    return parts[0] + tail
  }
  let out = parts[0]
  for (let i = 1; i < parts.length; i++) {
    let part = parts[i]
    if (consume && part.startsWith('\n')) part = part.slice(1)
    out += part
  }
  return out
}

test('replace_all over MIXED trailing context deletes EVERY occurrence (the bug)', () => {
  // old behavior left the trailing DEBUG (not followed by \n) behind.
  assert.equal(deleteOccurrences('DEBUG\nkeep\nDEBUG', 'DEBUG', true), 'keep\n')
  assert.equal(oldDelete('DEBUG\nkeep\nDEBUG', 'DEBUG', true), 'keep\nDEBUG') // proves the bug
  // import example: all three `foo` removed (the final `foo\n` consumes its \n).
  assert.equal(
    deleteOccurrences("import foo from './foo'\nconst x = foo\n", 'foo', true),
    "import  from './'\nconst x = ",
  )
})

test('parity with old behavior on the shapes the live tool actually reaches', () => {
  // homogeneous replace_all (every occurrence followed by \n)
  for (const c of ['DEBUG\nDEBUG\n', 'x\nx\nx\n', 'a\n']) {
    assert.equal(
      deleteOccurrences(c, c.includes('DEBUG') ? 'DEBUG' : c[0], true),
      oldDelete(c, c.includes('DEBUG') ? 'DEBUG' : c[0], true),
    )
  }
  // single edit (uniqueness-guarded → exactly one occurrence)
  for (const [c, s] of [
    ['a\nDEBUG\nb', 'DEBUG'],
    ['head DEBUG tail', 'DEBUG'],
    ['only', 'only'],
  ]) {
    assert.equal(deleteOccurrences(c, s, false), oldDelete(c, s, false))
  }
})

test('trailing-newline consumption is per-occurrence and never doubles', () => {
  // followed by \n → consume exactly one
  assert.equal(deleteOccurrences('X\n\nY', 'X', false), '\nY')
  // oldString already ends in \n → do not also eat the next \n
  assert.equal(deleteOccurrences('X\n\nY', 'X\n', false), '\nY')
  // not followed by \n → consume nothing
  assert.equal(deleteOccurrences('foo bar foo', 'foo', true), ' bar ')
})

test('empty oldString is a no-op', () => {
  assert.equal(deleteOccurrences('anything', '', true), 'anything')
})

test('differential vs an independent split-based reference (2000 random inputs)', () => {
  const alphabet = ['a', 'b', 'D', 'E', 'B', 'U', 'G', ' ', '\n', '\n']
  const tokens = ['a', 'D', 'DE', 'DEBUG', 'ab', '\n', 'a\n', ' ']
  for (let i = 0; i < 2000; i++) {
    const len = 1 + Math.floor(Math.random() * 40)
    let content = ''
    for (let j = 0; j < len; j++) {
      content += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    const oldString = tokens[Math.floor(Math.random() * tokens.length)]
    for (const replaceAll of [false, true]) {
      assert.equal(
        deleteOccurrences(content, oldString, replaceAll),
        refDelete(content, oldString, replaceAll),
        `mismatch: content=${JSON.stringify(content)} old=${JSON.stringify(oldString)} all=${replaceAll}`,
      )
    }
  }
})
