import { test } from 'node:test'
import assert from 'node:assert/strict'

import { truncateSnippet } from '../src/tools/FileEditTool/snippetTruncate.mjs'

// countCharInString (src/utils/stringUtils.ts), inlined verbatim — the leaf takes
// it injected, and the .ts source is not importable from a node .mjs test.
function countCharInString(str, char, start = 0) {
  let count = 0
  let i = str.indexOf(char, start)
  while (i !== -1) {
    count++
    i = str.indexOf(char, i + 1)
  }
  return count
}

const trunc = (full, cap) => truncateSnippet(full, cap, countCharInString)

// The exact pre-fix arithmetic, as a differential oracle.
function oldTruncate(full, cap) {
  if (full.length <= cap) return full
  const cutoff = full.lastIndexOf('\n', cap)
  const kept = cutoff > 0 ? full.slice(0, cutoff) : full.slice(0, cap)
  const remaining = countCharInString(full, '\n', kept.length) + 1
  return `${kept}\n\n... [${remaining} lines truncated] ...`
}

const reported = out => {
  const m = out.match(/\[(\d+) lines truncated\]/)
  return m ? Number(m[1]) : null
}
const keptPart = out => out.split('\n\n... [')[0]
// ground truth: lines in full minus lines actually shown (the kept prefix).
const trueHidden = (full, out) =>
  full.split('\n').length - keptPart(out).split('\n').length

test('THE FIX: a line-boundary cut reports the exact hidden-line count (was +1)', () => {
  const full = 'A\nB\nC\nD' // 4 lines
  const cap = 3 // cuts at the '\n' after B -> keeps "A\nB", hides C,D = 2
  const out = trunc(full, cap)
  assert.equal(reported(out), 2)
  assert.equal(keptPart(out), 'A\nB')
  // the old arithmetic over-counted by exactly 1
  assert.equal(reported(oldTruncate(full, cap)), 3)
})

test('reported count equals the true hidden-line count on a large multi-line snippet', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `${i + 1}  ` + 'x'.repeat(80))
  const full = lines.join('\n')
  const cap = 8192
  const out = trunc(full, cap)
  assert.equal(reported(out), trueHidden(full, out))
  // old over-reports by exactly 1 here
  assert.equal(reported(oldTruncate(full, cap)), reported(out) + 1)
})

test('FUZZ: reported hidden count always equals the true hidden-line count', () => {
  let seed = 0x51736ab1
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let iter = 0; iter < 500; iter++) {
    const n = 2 + Math.floor(rnd() * 60)
    const lines = Array.from({ length: n }, () =>
      'y'.repeat(1 + Math.floor(rnd() * 30)),
    )
    const full = lines.join('\n')
    const cap = 1 + Math.floor(rnd() * full.length)
    const out = trunc(full, cap)
    if (full.length <= cap) {
      assert.equal(out, full)
      continue
    }
    // line-boundary cut (a newline exists within the cap): the count must be exact
    if (full.lastIndexOf('\n', cap) > 0) {
      assert.equal(
        reported(out),
        trueHidden(full, out),
        `count mismatch full.len=${full.length} cap=${cap}`,
      )
    }
  }
})

test('no truncation when the snippet fits the cap', () => {
  assert.equal(trunc('a\nb\nc', 100), 'a\nb\nc')
  assert.equal(trunc('', 100), '')
})

test('a mid-line cut (single line longer than the cap) keeps the +1 for the split line', () => {
  // one 50-char line, then two short lines; cap 20 lands mid-first-line.
  const full = 'z'.repeat(50) + '\nshort1\nshort2'
  const cap = 20
  assert.equal(full.lastIndexOf('\n', cap), -1) // no newline within the cap
  const out = trunc(full, cap)
  // mid-line cut: this branch is unchanged from the old code (the +1 counts the
  // partially-shown line whose remainder is hidden).
  assert.equal(out, oldTruncate(full, cap))
  assert.equal(reported(out), 3) // partial line 1 + line 2 + line 3
})
