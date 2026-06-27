import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sortDirentsByName } from '../src/utils/sortDirentsByName.mjs'

const names = arr => arr.map(e => e.name)

test('sorts entries by name deterministically', () => {
  const entries = [{ name: '10-override.md' }, { name: '00-base.md' }, { name: '05-mid.md' }]
  assert.deepEqual(names(sortDirentsByName(entries)), [
    '00-base.md',
    '05-mid.md',
    '10-override.md',
  ])
})

test('does not mutate the input array', () => {
  const entries = [{ name: 'b' }, { name: 'a' }]
  const copy = [...entries]
  sortDirentsByName(entries)
  assert.deepEqual(entries, copy, 'input order is preserved')
})

test('is order-independent: any readdir order yields the same result', () => {
  const a = [{ name: 'x.md' }, { name: 'y.md' }, { name: 'z.md' }]
  const b = [{ name: 'z.md' }, { name: 'x.md' }, { name: 'y.md' }]
  assert.deepEqual(names(sortDirentsByName(a)), names(sortDirentsByName(b)))
})

test('empty and single-element inputs', () => {
  assert.deepEqual(sortDirentsByName([]), [])
  assert.deepEqual(names(sortDirentsByName([{ name: 'only.md' }])), ['only.md'])
})

test('works on Dirent-like objects (extra props preserved)', () => {
  const entries = [
    { name: 'b.md', isFile: () => true },
    { name: 'a.md', isFile: () => true },
  ]
  const sorted = sortDirentsByName(entries)
  assert.equal(sorted[0].name, 'a.md')
  assert.equal(typeof sorted[0].isFile, 'function')
})
