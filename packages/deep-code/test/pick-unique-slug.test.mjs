import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isValidPlanSlug } from '../src/utils/isValidPlanSlug.mjs'
import { pickUniqueSlug } from '../src/utils/pickUniqueSlug.mjs'

// A generator that yields a fixed sequence (then repeats the last value).
const seqGen = values => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

test('returns the first non-colliding slug (uniquify never called)', () => {
  let uniquifyCalls = 0
  const slug = pickUniqueSlug(
    seqGen(['alpha']),
    () => false, // nothing collides
    s => {
      uniquifyCalls++
      return `${s}-x`
    },
    10,
  )
  assert.equal(slug, 'alpha')
  assert.equal(uniquifyCalls, 0, 'uniquify must not run when a slug is free')
})

test('skips colliding draws and returns the first free one', () => {
  const taken = new Set(['a', 'b'])
  const slug = pickUniqueSlug(
    seqGen(['a', 'b', 'c']),
    s => taken.has(s),
    s => `${s}-x`,
    10,
  )
  assert.equal(slug, 'c')
})

test('on exhaustion, uniquifies the LAST drawn slug exactly once', () => {
  const seen = []
  const slug = pickUniqueSlug(
    seqGen(['s1', 's2', 's3']), // 4th+ draws repeat 's3'
    () => true, // everything collides
    s => {
      seen.push(s)
      return `${s}-uuid`
    },
    10,
  )
  assert.equal(slug, 's3-uuid', 'uniquify applied to the last drawn slug')
  assert.deepEqual(seen, ['s3'], 'uniquify called exactly once, with the last slug')
})

test('respects maxRetries (number of draws before uniquifying)', () => {
  let draws = 0
  pickUniqueSlug(
    () => {
      draws++
      return 'dup'
    },
    () => true,
    s => `${s}-x`,
    3,
  )
  assert.equal(draws, 3, 'exactly maxRetries draws before falling back')
})

test('the wrapper-style uniquify produces a slug that still passes isValidPlanSlug', () => {
  // The real wrapper appends `-${randomUUID().slice(0,8)}`; a uuid fragment is
  // hex + hyphens, so the result must remain a valid (traversal-safe) plan slug.
  const base = 'whimsical-dancing-otter'
  const uniquified = pickUniqueSlug(
    () => base,
    () => true,
    s => `${s}-1a2b3c4d`,
    5,
  )
  assert.equal(uniquified, 'whimsical-dancing-otter-1a2b3c4d')
  assert.ok(isValidPlanSlug(uniquified), 'uniquified slug must stay valid')
})
