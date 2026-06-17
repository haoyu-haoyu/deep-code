import assert from 'node:assert/strict'
import { test } from 'node:test'

import { splitHomeShortcut } from '../src/utils/homeShortcut.mjs'

// --- Cross-platform: bare `~` and the POSIX `~/` separator ---

test('bare ~ returns the empty rest on every platform', () => {
  for (const p of ['windows', 'macos', 'linux', 'wsl', 'unknown']) {
    assert.equal(splitHomeShortcut('~', p), '', `platform=${p}`)
  }
})

test('~/x returns the rest after the slash on every platform', () => {
  for (const p of ['windows', 'macos', 'linux', 'wsl', 'unknown']) {
    assert.equal(splitHomeShortcut('~/Documents', p), 'Documents', `platform=${p}`)
    assert.equal(splitHomeShortcut('~/a/b', p), 'a/b', `platform=${p}`)
    assert.equal(splitHomeShortcut('~/', p), '', `platform=${p}`)
  }
})

// --- Windows-only: the `~\` backslash separator ---

test('~\\x expands on Windows', () => {
  assert.equal(splitHomeShortcut('~\\Documents', 'windows'), 'Documents')
  assert.equal(splitHomeShortcut('~\\a\\b', 'windows'), 'a\\b')
  assert.equal(splitHomeShortcut('~\\', 'windows'), '')
})

test('~\\x is NOT a home shortcut on POSIX (backslash is a legal filename char)', () => {
  for (const p of ['macos', 'linux', 'wsl', 'unknown']) {
    assert.equal(splitHomeShortcut('~\\Documents', p), null, `platform=${p}`)
    assert.equal(splitHomeShortcut('~\\', p), null, `platform=${p}`)
  }
})

// --- Non-home paths return null on every platform ---

test('non-home paths return null', () => {
  for (const p of ['windows', 'macos', 'linux']) {
    assert.equal(splitHomeShortcut('/absolute/path', p), null, `platform=${p}`)
    assert.equal(splitHomeShortcut('./relative', p), null, `platform=${p}`)
    assert.equal(splitHomeShortcut('plain', p), null, `platform=${p}`)
    // `~user` (no separator) is NOT expanded — only `~`, `~/`, and Windows `~\`.
    assert.equal(splitHomeShortcut('~user', p), null, `platform=${p}`)
    assert.equal(splitHomeShortcut('~user/x', p), null, `platform=${p}`)
    // A `~` that is not leading is not a shortcut.
    assert.equal(splitHomeShortcut('a~/b', p), null, `platform=${p}`)
    assert.equal(splitHomeShortcut('', p), null, `platform=${p}`)
  }
})

// A forward-slash `~/` shortcut still works on Windows alongside the backslash form.
test('~/x works on Windows too (forward slash is also valid there)', () => {
  assert.equal(splitHomeShortcut('~/Documents', 'windows'), 'Documents')
})
