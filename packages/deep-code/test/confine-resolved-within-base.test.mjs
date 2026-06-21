import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'

import { confineResolvedWithinBase } from '../src/utils/plugins/confineResolvedWithinBase.mjs'

const BASE = `${sep}cache${sep}plugins${sep}myplugin`

// A resolveFn that maps each path to its (test-controlled) canonical realpath —
// mirroring safeResolvePath(fs, p).resolvedPath. Paths not in the map resolve to
// themselves (an in-tree non-symlink). 'THROW' makes resolveFn throw.
function makeResolve(map) {
  return p => {
    if (map[p] === 'THROW') throw new Error('realpath failed')
    return map[p] ?? p
  }
}

test('THE FIX: a plugin file that resolves OUTSIDE the plugin dir is rejected', () => {
  const candidate = `${BASE}${sep}commands${sep}x.md`
  const resolve = makeResolve({
    [BASE]: BASE,
    [candidate]: `${sep}home${sep}u${sep}.ssh${sep}id_rsa`, // symlink escapes
  })
  assert.equal(confineResolvedWithinBase(resolve, BASE, candidate), false)
})

test('an in-tree file (resolves to itself / inside the base) is allowed', () => {
  const candidate = `${BASE}${sep}commands${sep}x.md`
  assert.equal(
    confineResolvedWithinBase(makeResolve({ [BASE]: BASE }), BASE, candidate),
    true,
  )
  // an in-tree symlink (resolves to another in-tree path) is allowed
  const inTreeLink = `${BASE}${sep}link.md`
  assert.equal(
    confineResolvedWithinBase(
      makeResolve({ [BASE]: BASE, [inTreeLink]: `${BASE}${sep}real.md` }),
      BASE,
      inTreeLink,
    ),
    true,
  )
})

test('a symlinked plugin ROOT is handled (base is resolved too)', () => {
  const candidate = `${BASE}${sep}c.md`
  // base resolves to a canonical dir; candidate resolves under THAT canonical dir
  const realBase = `${sep}real${sep}myplugin`
  const resolve = makeResolve({
    [BASE]: realBase,
    [candidate]: `${realBase}${sep}c.md`,
  })
  assert.equal(confineResolvedWithinBase(resolve, BASE, candidate), true)
})

test('a resolveFn error (broken symlink / missing) rejects (fail-closed)', () => {
  const candidate = `${BASE}${sep}c.md`
  assert.equal(
    confineResolvedWithinBase(
      makeResolve({ [BASE]: BASE, [candidate]: 'THROW' }),
      BASE,
      candidate,
    ),
    false,
  )
})

test('a sibling dir sharing a string prefix is NOT contained', () => {
  const candidate = `${BASE}-evil${sep}c.md`
  assert.equal(
    confineResolvedWithinBase(
      makeResolve({ [BASE]: BASE, [candidate]: `${BASE}-evil${sep}c.md` }),
      BASE,
      candidate,
    ),
    false,
  )
})
