import { test } from 'node:test'
import assert from 'node:assert/strict'

import { truncateAtCodeUnitBoundary } from '../src/utils/truncateAtCodeUnitBoundary.mjs'

// Build astral chars from code units so the source has no literal escapes.
const GRINNING = String.fromCharCode(0xd83d, 0xde00) // U+1F600, 2 UTF-16 units
const HIGH = String.fromCharCode(0xd83d) // a lone high surrogate
const LOW = String.fromCharCode(0xde00) // a lone low surrogate

const isLoneSurrogate = ch => {
  const c = ch.charCodeAt(0)
  return c >= 0xd800 && c <= 0xdfff
}
// True iff the string contains NO unpaired surrogate.
function isWellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false
    }
  }
  return true
}

test('plain ASCII: identical to slice', () => {
  assert.equal(truncateAtCodeUnitBoundary('abcdef', 3), 'abc')
  assert.equal(truncateAtCodeUnitBoundary('abcdef', 0), '')
  assert.equal(truncateAtCodeUnitBoundary('abc', 10), 'abc') // shorter than limit
  assert.equal(truncateAtCodeUnitBoundary('abc', 3), 'abc') // exactly the limit
})

test('THE FIX: a cut that would split a surrogate pair drops the whole astral char', () => {
  // "ab😀cd" — units: a(0) b(1) HIGH(2) LOW(3) c(4) d(5)
  const s = 'ab' + GRINNING + 'cd'
  // slice(0,3) would keep a(0)b(1)HIGH(2) — a lone high surrogate (invalid).
  const out = truncateAtCodeUnitBoundary(s, 3)
  assert.equal(out, 'ab') // backed off, pair excluded
  assert.ok(isWellFormed(out))
  // a naive slice WOULD be malformed — proves the bug the fix addresses
  assert.ok(!isWellFormed(s.slice(0, 3)))
})

test('cutting right AFTER a full pair keeps it whole', () => {
  const s = 'ab' + GRINNING + 'cd'
  const out = truncateAtCodeUnitBoundary(s, 4) // a b HIGH LOW
  assert.equal(out, 'ab' + GRINNING)
  assert.ok(isWellFormed(out))
})

test('cutting before a pair is unaffected', () => {
  const s = 'ab' + GRINNING + 'cd'
  assert.equal(truncateAtCodeUnitBoundary(s, 2), 'ab')
  assert.ok(isWellFormed(truncateAtCodeUnitBoundary(s, 2)))
})

test('result never exceeds maxUnits and is at most 1 shorter', () => {
  const s = 'x' + GRINNING + GRINNING + 'y' + GRINNING
  for (let n = 1; n <= s.length; n++) {
    const out = truncateAtCodeUnitBoundary(s, n)
    assert.ok(out.length <= n, `len ${out.length} <= ${n}`)
    assert.ok(out.length >= n - 1, `backs off at most 1 (len ${out.length}, n ${n})`)
    assert.ok(isWellFormed(out), `well-formed at n=${n}`)
  }
})

test('a pre-existing LONE surrogate in the input is preserved (we only avoid CREATING a split)', () => {
  // "a" + lone HIGH + "b": cutting at 2 keeps a + HIGH. The HIGH is followed by
  // 'b' (not a low surrogate), so there is no pair to split — preserve as-is.
  const s = 'a' + HIGH + 'b'
  assert.equal(truncateAtCodeUnitBoundary(s, 2), 'a' + HIGH)
  // lone LOW at the boundary likewise untouched
  const s2 = 'a' + LOW + 'b'
  assert.equal(truncateAtCodeUnitBoundary(s2, 2), 'a' + LOW)
})

test('fuzz: never emits a NEW lone surrogate that a slice would have', () => {
  // deterministic LCG; alphabet mixes ascii + astral so cuts often hit pairs
  let seed = 0x1234abcd
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const atoms = ['a', 'b', GRINNING, 'cd', GRINNING + 'z']
  for (let iter = 0; iter < 5000; iter++) {
    let s = ''
    const k = 1 + Math.floor(rnd() * 8)
    for (let j = 0; j < k; j++) s += atoms[Math.floor(rnd() * atoms.length)]
    const n = Math.floor(rnd() * (s.length + 2))
    const out = truncateAtCodeUnitBoundary(s, n)
    // if the input up to here was well-formed, the output must be too
    if (isWellFormed(s)) assert.ok(isWellFormed(out), `iter ${iter} n=${n}`)
    assert.ok(out.length <= Math.max(0, n))
    assert.ok(s.startsWith(out)) // always a prefix of the input
  }
})
