import { test } from 'node:test'
import assert from 'node:assert/strict'

import { numberDiffLines } from '../src/components/StructuredDiff/numberDiffLines.mjs'

// Verbatim port of the OLD destructive-shift implementation, used as a
// differential reference to prove the index-walk rewrite is byte-identical.
function numberDiffLinesOld(diff, startLine) {
  let i = startLine
  const result = []
  const queue = [...diff]
  while (queue.length > 0) {
    const current = queue.shift()
    const { code, type, originalCode, wordDiff, matchedLine } = current
    const line = { code, type, i, originalCode, wordDiff, matchedLine }
    switch (type) {
      case 'nochange':
        i++
        result.push(line)
        break
      case 'add':
        i++
        result.push(line)
        break
      case 'remove': {
        result.push(line)
        let numRemoved = 0
        while (queue[0]?.type === 'remove') {
          i++
          const current = queue.shift()
          const { code, type, originalCode, wordDiff, matchedLine } = current
          const line = { code, type, i, originalCode, wordDiff, matchedLine }
          result.push(line)
          numRemoved++
        }
        i -= numRemoved
        break
      }
    }
  }
  return result
}

function line(type, n) {
  return {
    code: `${type}-${n}`,
    type,
    i: 0,
    originalCode: `orig-${n}`,
    wordDiff: n % 2 === 0,
  }
}

test('empty diff → empty result', () => {
  assert.deepEqual(numberDiffLines([], 1), [])
})

test('a simple add/nochange sequence numbers sequentially', () => {
  const diff = [line('nochange', 0), line('add', 1), line('nochange', 2)]
  assert.deepEqual(
    numberDiffLines(diff, 5).map(l => l.i),
    [5, 6, 7],
  )
})

test('a run of removes shares the following line numbers, then rewinds', () => {
  // remove,remove,nochange: the two removes get 5,6; the counter rewinds to 5
  // for the nochange (matching unified-diff numbering of deletions)
  const diff = [line('remove', 0), line('remove', 1), line('nochange', 2)]
  assert.deepEqual(
    numberDiffLines(diff, 5).map(l => l.i),
    [5, 6, 5],
  )
})

test('differential: index-walk matches the old destructive-shift impl exactly', () => {
  const types = ['add', 'remove', 'nochange']
  // deterministic pseudo-random sequences, including long all-remove runs that
  // exercise the inner shift loop
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let trial = 0; trial < 300; trial++) {
    const len = Math.floor(rand() * 60)
    const diff = []
    for (let k = 0; k < len; k++) {
      // bias toward 'remove' so long remove-runs occur
      const t = rand() < 0.5 ? 'remove' : types[Math.floor(rand() * 3)]
      diff.push(line(t, k))
    }
    const start = Math.floor(rand() * 100)
    assert.deepEqual(
      numberDiffLines(diff, start),
      numberDiffLinesOld(diff, start),
    )
  }
})

test('a long all-remove hunk (the inner-loop O(n^2) case) is numbered correctly', () => {
  const N = 500
  const diff = Array.from({ length: N }, (_, k) => line('remove', k))
  const out = numberDiffLines(diff, 1)
  // every removed line is numbered 1..N (the counter advances across the run)
  assert.deepEqual(
    out.map(l => l.i),
    Array.from({ length: N }, (_, k) => 1 + k),
  )
  // matches the reference impl
  assert.deepEqual(out, numberDiffLinesOld(diff, 1))
})

test('does not mutate the input array', () => {
  const diff = [line('remove', 0), line('add', 1)]
  const copy = diff.slice()
  numberDiffLines(diff, 1)
  assert.deepEqual(diff, copy)
  assert.equal(diff.length, 2)
})
