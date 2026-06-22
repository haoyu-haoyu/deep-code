import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldApplyInclusiveBump } from '../src/vim/operatorRangeCore.mjs'

const NL = String.fromCharCode(10) // '\n' without a \u escape

test('THE FIX: $ landing on a newline does NOT bump (D/C/d$/c$ keep the line break)', () => {
  // "hello\nworld", cursor@0, $ -> target = newline index 5, end char is '\n'
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset: 0,
      targetOffset: 5,
      charAtEnd: NL,
    }),
    false,
  )
  // mid-line $: cursor@4 ('o'), target = newline index 5 — still suppressed
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset: 4,
      targetOffset: 5,
      charAtEnd: NL,
    }),
    false,
  )
})

test('e/E (inclusive, landing on a visible char) STILL bump', () => {
  // "foo bar", cursor@0, e -> lands on 'o' (offset 2); end char is a word char
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset: 0,
      targetOffset: 2,
      charAtEnd: 'o',
    }),
    true,
  )
})

test('$ at end-of-file (no trailing newline) still bumps — a no-op there', () => {
  // last line "world", $ -> target = text.length, char at end is undefined
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset: 0,
      targetOffset: 5,
      charAtEnd: undefined,
    }),
    true,
  )
})

test('non-inclusive motions never bump', () => {
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: false,
      cursorOffset: 0,
      targetOffset: 5,
      charAtEnd: 'x',
    }),
    false,
  )
})

test('a backward inclusive range (cursor past target) does not bump', () => {
  assert.equal(
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset: 5,
      targetOffset: 0,
      charAtEnd: 'x',
    }),
    false,
  )
})

test('end-to-end range simulation: D@0 on "hello\\nworld" deletes "hello", keeps the newline', () => {
  // mirror getOperatorRange's inclusive branch + applyOperator delete to prove
  // the observable result on the real $-motion shape.
  const text = 'hello' + NL + 'world'
  const cursorOffset = 0
  const targetOffset = text.indexOf(NL) // endOfLogicalLine = newline index = 5
  let to = Math.max(cursorOffset, targetOffset) // 5
  const from = Math.min(cursorOffset, targetOffset) // 0
  if (
    shouldApplyInclusiveBump({
      isInclusive: true,
      cursorOffset,
      targetOffset,
      charAtEnd: text[to],
    })
  ) {
    to = to + 1 // (Cursor.nextOffset over a single-codeunit char)
  }
  const deleted = text.slice(from, to)
  const remaining = text.slice(0, from) + text.slice(to)
  assert.equal(deleted, 'hello') // register: no trailing newline
  assert.equal(remaining, NL + 'world') // newline survives, lines NOT joined

  // contrast: the OLD (always-bump) behaviour would have joined the lines
  const oldTo = Math.max(cursorOffset, targetOffset) + 1 // 6
  assert.equal(text.slice(0, from) + text.slice(oldTo), 'world') // the bug
})
