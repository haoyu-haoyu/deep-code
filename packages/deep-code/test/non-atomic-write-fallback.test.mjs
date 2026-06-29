import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nonAtomicWriteFallback } from '../src/utils/nonAtomicWriteFallback.mjs'

// The data-safety invariant: the non-atomic fallback (taken after the atomic
// temp-write + rename failed) must NEVER perform the truncating in-place write
// over an EXISTING file. writeFileSync opens with O_TRUNC, so a direct write
// empties the target before a single byte is written — on ENOSPC / EROFS / a
// crash, that leaves the file empty, the original unrecoverable, and the new
// content never written. So when the target already held data, the fallback
// re-throws the atomic error and leaves the file on disk untouched.

test('existing target: re-throws the atomic error and never truncates', () => {
  const atomicError = new Error('ENOSPC: no space left on device')
  let wrote = false
  assert.throws(
    () =>
      nonAtomicWriteFallback({
        targetExists: true,
        atomicError,
        writeInPlace: () => {
          wrote = true
        },
      }),
    err => err === atomicError, // the SAME error object, not a wrapped one
  )
  assert.equal(wrote, false, 'must not touch an existing file')
})

test('new target: performs the in-place create (nothing to lose)', () => {
  let wrote = false
  nonAtomicWriteFallback({
    targetExists: false,
    atomicError: new Error('rename unsupported'),
    writeInPlace: () => {
      wrote = true
    },
  })
  assert.equal(wrote, true, 'a new file still gets created via the fallback')
})

test('new target: a write error from the create propagates', () => {
  const writeError = new Error('EACCES: permission denied')
  assert.throws(
    () =>
      nonAtomicWriteFallback({
        targetExists: false,
        atomicError: new Error('rename unsupported'),
        writeInPlace: () => {
          throw writeError
        },
      }),
    err => err === writeError,
  )
})
