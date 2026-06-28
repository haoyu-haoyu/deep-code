import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapseSplitParts } from '../src/utils/bash/collapseSplitParts.mjs'

// A stand-in for placeholders.NEW_LINE (random-salted at runtime).
const NL = '__NEW_LINE_deadbeef__'
const glob = pattern => ({ op: 'glob', pattern })
const op = o => ({ op: o })

test('adjacent bareword strings merge into one command', () => {
  assert.deepEqual(collapseSplitParts(['echo', 'a', 'b'], NL), ['echo a b'])
})

test('a single unquoted newline becomes a null command boundary', () => {
  assert.deepEqual(collapseSplitParts(['echo', 'a', NL, 'rm', 'b'], NL), [
    'echo a',
    null,
    'rm b',
  ])
})

test('SECURITY: TWO consecutive newlines do not leak the placeholder (the bug)', () => {
  // Predecessor of the 2nd NL is the null pushed by the 1st. Previously the
  // boundary push was guarded by "prev is a string", so the 2nd NL fell through
  // to push(part) and leaked `NL` onto the next command -> `NL rm b`.
  const out = collapseSplitParts(['echo', 'a', NL, NL, 'rm', 'b'], NL)
  assert.deepEqual(out, ['echo a', null, null, 'rm b'])
  assert.ok(!out.includes(NL), 'placeholder must never survive as a token')
  assert.ok(
    !out.some(p => typeof p === 'string' && p.includes(NL)),
    'placeholder must never be glued onto a command',
  )
})

test('SECURITY: a LEADING newline does not leak the placeholder', () => {
  const out = collapseSplitParts([NL, 'rm', 'b'], NL)
  assert.deepEqual(out, [null, 'rm b'])
  assert.ok(!out.some(p => typeof p === 'string' && p.includes(NL)))
})

test('SECURITY: leading + interior + trailing runs of newlines never leak', () => {
  for (const parsed of [
    [NL, NL, 'rm', 'b'], // leading run
    ['echo', 'a', NL, NL, NL, 'rm'], // 3 interior
    ['echo', 'a', NL, NL, NL, NL, 'rm'], // 4 interior
    ['rm', 'b', NL, NL], // trailing run
    ['a', NL, NL, 'b', NL, NL, 'c'], // multiple runs
  ]) {
    const out = collapseSplitParts(parsed, NL)
    assert.ok(
      !out.some(p => typeof p === 'string' && p.includes(NL)),
      `placeholder leaked for ${JSON.stringify(parsed)} -> ${JSON.stringify(out)}`,
    )
  }
})

test('runs of newlines collapse to boundaries, exposing each command cleanly', () => {
  assert.deepEqual(
    collapseSplitParts(['a', NL, NL, 'b', NL, NL, 'c'], NL).filter(
      p => p !== null,
    ),
    ['a', 'b', 'c'],
  )
})

test('a glob folds onto the preceding command', () => {
  assert.deepEqual(collapseSplitParts(['ls', glob('*.txt')], NL), ['ls *.txt'])
})

test('a glob with no preceding string passes through as its own entry', () => {
  const g = glob('*.txt')
  assert.deepEqual(collapseSplitParts([g], NL), [g])
})

test('operators and comments pass through as their own entries', () => {
  const and = op('&&')
  assert.deepEqual(collapseSplitParts(['echo', 'a', and, 'rm', 'b'], NL), [
    'echo a',
    and,
    'rm b',
  ])
  const c = { comment: 'note' }
  assert.deepEqual(collapseSplitParts(['echo', 'a', c], NL), ['echo a', c])
})

test('empty input yields empty output', () => {
  assert.deepEqual(collapseSplitParts([], NL), [])
})
