import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractAtMentionedFiles,
  parseAtMentionedFileLines,
} from '../src/utils/atMentionParsing.mjs'

// The pre-fix quoted-mention extraction, ported verbatim as a differential
// oracle (whitespace-or-start anchor that CONSUMED the boundary char). The
// regular-mention half is unchanged, so we only need to mirror the quoted half
// plus the same regular pass.
const PATH_CHARS = '\\p{L}\\p{N}\\p{M}_\\-./\\\\()\\[\\]~:'
const WORD_CHARS = '\\p{L}\\p{N}\\p{M}_'
const fileMentionRegex = () =>
  new RegExp(`(^|\\s)@[${PATH_CHARS}#]*[${WORD_CHARS}]`, 'gu')
function oldExtract(content) {
  const quotedAtMentionRegex = /(^|\s)@"([^"]+)"(#L\d+(?:-\d+)?)?/g
  const quoted = []
  let m
  while ((m = quotedAtMentionRegex.exec(content)) !== null) {
    if (m[2] && !m[2].endsWith(' (agent)')) quoted.push(m[2] + (m[3] ?? ''))
  }
  const regular = []
  for (const full of content.match(fileMentionRegex()) || []) {
    const filename = full.slice(full.indexOf('@') + 1)
    if (!filename.startsWith('"')) regular.push(filename)
  }
  return [...new Set([...quoted, ...regular])]
}

test('THE FIX: two adjacent quoted mentions both extract', () => {
  assert.deepEqual(
    extractAtMentionedFiles('@"file1.txt"@"file2.txt"'),
    ['file1.txt', 'file2.txt'],
  )
  // the pre-fix code dropped the second
  assert.deepEqual(oldExtract('@"file1.txt"@"file2.txt"'), ['file1.txt'])
})

test('adjacent quoted mentions each keep their own #L range', () => {
  assert.deepEqual(
    extractAtMentionedFiles('@"a b.txt"#L1-2@"c d.ts"#L5'),
    ['a b.txt#L1-2', 'c d.ts#L5'],
  )
  // and the ranges parse correctly downstream
  assert.deepEqual(parseAtMentionedFileLines('a b.txt#L1-2'), {
    filename: 'a b.txt',
    lineStart: 1,
    lineEnd: 2,
  })
})

test('three adjacent mentions, mixed with a normal-spaced one', () => {
  assert.deepEqual(
    extractAtMentionedFiles('@"x.txt"@"y.txt" @"z.txt"'),
    ['x.txt', 'y.txt', 'z.txt'],
  )
})

test('an adjacent agent mention is still skipped', () => {
  // @"foo (agent)" is an agent reference, not a file — must not be extracted,
  // even when adjacent to a real file mention.
  assert.deepEqual(
    extractAtMentionedFiles('@"real.txt"@"helper (agent)"'),
    ['real.txt'],
  )
})

test('SUPERSET: the fix never DROPS a mention the old code found (differential fuzz)', () => {
  let seed = 0x51ce77a9
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const atoms = [
    '@"a"', '@"b c"', '@"d"#L1-2', ' ', 'x', '"', '\n', '@plain', '@"e (agent)"',
    'word ', '.', '@dir/file.ts',
  ]
  for (let iter = 0; iter < 8000; iter++) {
    let s = ''
    const k = 1 + Math.floor(rnd() * 7)
    for (let j = 0; j < k; j++) s += atoms[Math.floor(rnd() * atoms.length)]
    const before = new Set(oldExtract(s))
    const after = new Set(extractAtMentionedFiles(s))
    for (const v of before) {
      assert.ok(after.has(v), `regression: "${v}" dropped for input ${JSON.stringify(s)}`)
    }
  }
})

test('NO OVER-MATCH: an in-word @"…" (email-like or digit-glued) is still NOT a mention', () => {
  // preceded by a word char and not glued to an accepted mention -> rejected,
  // exactly as before (the fix only adds glued-to-accepted cases).
  assert.deepEqual(extractAtMentionedFiles('foo@"x.txt"'), [])
  assert.deepEqual(extractAtMentionedFiles('123@"x.txt"'), [])
  assert.deepEqual(extractAtMentionedFiles('a@"b"@"c"'), []) // first rejected -> chain rejected
  // but a real leading mention still chains its glued neighbour
  assert.deepEqual(extractAtMentionedFiles(' @"b"@"c"'), ['b', 'c'])
})

test('EQUIVALENCE: with whitespace separators the result is unchanged from before', () => {
  const cases = [
    '@"one.txt" @"two.txt"',
    'see @"my file.md"#L3-9 then @plain.ts, done',
    'no mentions here at all',
    '@"a"\n@"b"',
    'leading @"x.txt"',
  ]
  for (const c of cases) {
    assert.deepEqual(extractAtMentionedFiles(c), oldExtract(c), `for ${JSON.stringify(c)}`)
  }
})
