import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveSymlinkWriteTarget } from '../src/utils/resolveSymlinkWriteTarget.mjs'

// Model a symlink chain as a map of one-hop links. A path absent from the map is
// "not a symlink / does not exist" → the hop returns null (it is the write
// target), mirroring readlinkSync throwing EINVAL/ENOENT.
function hopFromChain(chain) {
  return p => (p in chain ? chain[p] : null)
}

test('a plain (non-symlink) path is its own write target', () => {
  assert.equal(resolveSymlinkWriteTarget('/x/plain', hopFromChain({})), '/x/plain')
})

test('single-hop link resolves to its target (unchanged behavior)', () => {
  const chain = { '/x/top': '/x/real' } // /x/real is not in the map → not a link
  assert.equal(resolveSymlinkWriteTarget('/x/top', hopFromChain(chain)), '/x/real')
})

test('multi-hop chain resolves to the canonical end, not an intermediate (the fix)', () => {
  // top -> mid -> real ; the OLD one-hop code stopped at /x/mid and clobbered it.
  const chain = { '/x/top': '/x/mid', '/x/mid': '/x/real' }
  assert.equal(resolveSymlinkWriteTarget('/x/top', hopFromChain(chain)), '/x/real')
})

test('deep chain follows every hop to the canonical file', () => {
  const chain = { '/a': '/b', '/b': '/c', '/c': '/d', '/d': '/e' }
  assert.equal(resolveSymlinkWriteTarget('/a', hopFromChain(chain)), '/e')
})

test('dangling final target is returned (so the writer creates it)', () => {
  // top -> mid -> /x/missing ; /x/missing is absent → null → it is the target.
  const chain = { '/x/top': '/x/mid', '/x/mid': '/x/missing' }
  assert.equal(
    resolveSymlinkWriteTarget('/x/top', hopFromChain(chain)),
    '/x/missing',
  )
})

test('a direct dangling link is its own target (parity with one-hop)', () => {
  const chain = { '/x/top': '/x/missing' }
  assert.equal(
    resolveSymlinkWriteTarget('/x/top', hopFromChain(chain)),
    '/x/missing',
  )
})

test('a symlink cycle terminates instead of spinning forever', () => {
  const chain = { '/a': '/b', '/b': '/a' }
  // /a -> /b -> /a(visited) → stop. Must not loop; returns the last entry walked.
  const out = resolveSymlinkWriteTarget('/a', hopFromChain(chain))
  assert.equal(out, '/b')
})

test('a self-referential link terminates', () => {
  const chain = { '/a': '/a' }
  assert.equal(resolveSymlinkWriteTarget('/a', hopFromChain(chain)), '/a')
})

test('an unbounded chain is capped (no infinite walk) and stops after MAX_HOPS', () => {
  // Every path links to the next integer forever; the hop is called at most
  // MAX_HOPS (40) times, so resolution stops at a bounded depth.
  let calls = 0
  const hop = p => {
    calls++
    return `/n/${Number(p.slice(3)) + 1}`
  }
  const out = resolveSymlinkWriteTarget('/n/0', hop)
  assert.equal(calls, 40, 'hop is bounded by MAX_HOPS')
  assert.equal(out, '/n/40')
})
