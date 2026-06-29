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
// leading newline of the following segment ONLY when oldString is content-only
// (neither newline-terminated NOR newline-led — a newline-led oldString already
// removed its leading newline, so eating the trailing one would glue the next line).
function refDelete(content, oldString, replaceAll) {
  if (oldString === '') return content
  const consume = !oldString.endsWith('\n') && !oldString.startsWith('\n')
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

test('newline-LED oldString preserves the next line (no glue, no stranded match)', () => {
  // adjacent identical lines, replace_all: the OLD impl ate the second match's
  // leading newline → left it stranded AND glued ("code// X\nmore"); refDelete's
  // consume-on-led rule glued the tail ("codemore"). Correct: both removed,
  // structure preserved.
  assert.equal(
    deleteOccurrences('code\n// X\n// X\nmore', '\n// X', true),
    'code\nmore',
  )
  // single newline-led delete: keep the following line's leading newline.
  assert.equal(deleteOccurrences('a\nDEBUG\nb', '\nDEBUG', false), 'a\nb')
  // a blank line that was already there must survive (we only deleted the line).
  assert.equal(deleteOccurrences('a\nfoo\n\nb', '\nfoo', false), 'a\n\nb')
  // three adjacent newline-led lines all removed.
  assert.equal(
    deleteOccurrences('x\n-\n-\n-\ny', '\n-', true),
    'x\ny',
  )
})

test('differential vs an independent split-based reference (2000 random inputs)', () => {
  const alphabet = ['a', 'b', 'D', 'E', 'B', 'U', 'G', ' ', '\n', '\n', '-']
  // Includes multi-char newline-LED tokens (\nD, \nDEBUG, \n-) — the shape the
  // previous token set omitted, which hid the adjacent-occurrence under-deletion.
  const tokens = ['a', 'D', 'DE', 'DEBUG', 'ab', '\n', 'a\n', ' ', '\nD', '\nDEBUG', '\n-', '-']
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
