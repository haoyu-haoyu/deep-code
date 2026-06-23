import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tabAwareCursorColumn } from '../src/hooks/tabAwareCursorColumn.mjs'

// Minimal 8-column tab expander + width counter for the injected deps (the real
// ones are ink/tabstops expandTabs + ink/stringWidth; ASCII suffices to test the
// leaf's gating/slicing).
function expandTabs8(text) {
  let result = ''
  let col = 0
  for (const ch of text) {
    if (ch === '\t') {
      const spaces = 8 - (col % 8)
      result += ' '.repeat(spaces)
      col += spaces
    } else {
      result += ch
      col += 1
    }
  }
  return result
}
const measureWidth = s => Array.from(s).length

const deps = { expandTabs: expandTabs8, measureWidth }

test('THE FIX: a tab before the cursor advances the declared column to the tab stop', () => {
  // "a<TAB>b", cursor between the tab and 'b' (prefixEnd=2). 'b' renders at col 8.
  const col = tabAwareCursorColumn({
    lineText: 'a\tb',
    prefixEnd: 2,
    isPrecededByNewline: true,
    fallbackColumn: 1, // stringWidth("a\t") = 1 (tab counts 0) — the drift
    ...deps,
  })
  assert.equal(col, 8)
})

test('multiple tabs accumulate to successive 8-col stops', () => {
  // "a<TAB>b<TAB>c", cursor after the 2nd tab (prefixEnd=4): a(1) tab->8 b(9) tab->16
  const col = tabAwareCursorColumn({
    lineText: 'a\tb\tc',
    prefixEnd: 4,
    isPrecededByNewline: true,
    fallbackColumn: 2,
    ...deps,
  })
  assert.equal(col, 16)
})

test('no adjustment on a wrapped continuation row (not a logical line start)', () => {
  const col = tabAwareCursorColumn({
    lineText: 'a\tb',
    prefixEnd: 2,
    isPrecededByNewline: false,
    fallbackColumn: 1,
    ...deps,
  })
  assert.equal(col, 1) // unchanged
})

test('no adjustment when the row has no tab', () => {
  const col = tabAwareCursorColumn({
    lineText: 'hello world',
    prefixEnd: 5,
    isPrecededByNewline: true,
    fallbackColumn: 5,
    ...deps,
  })
  assert.equal(col, 5) // unchanged
})

test('no adjustment when the tab is AFTER the cursor (not in the prefix)', () => {
  const col = tabAwareCursorColumn({
    lineText: 'ab\tc',
    prefixEnd: 2, // prefix "ab" has no tab; the tab is at index 2
    isPrecededByNewline: true,
    fallbackColumn: 2,
    ...deps,
  })
  assert.equal(col, 2) // unchanged
})

test('cursor at the very start of the row returns the fallback (empty prefix)', () => {
  const col = tabAwareCursorColumn({
    lineText: '\tindented',
    prefixEnd: 0,
    isPrecededByNewline: true,
    fallbackColumn: 0,
    ...deps,
  })
  assert.equal(col, 0)
})

test('a leading tab puts the cursor after it at column 8', () => {
  const col = tabAwareCursorColumn({
    lineText: '\tindented',
    prefixEnd: 1, // just after the leading tab
    isPrecededByNewline: true,
    fallbackColumn: 0, // stringWidth("\t") = 0 — the drift
    ...deps,
  })
  assert.equal(col, 8)
})
