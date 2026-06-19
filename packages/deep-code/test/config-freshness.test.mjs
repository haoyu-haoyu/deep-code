import { test } from 'node:test'
import assert from 'node:assert/strict'

import { configIsUnchanged } from '../src/utils/configFreshness.mjs'

// configIsUnchanged(currMtime, currSize, cacheMtime, cacheSize)
//   true  = unchanged, the freshness watcher SKIPS the re-read
//   false = changed, the watcher RE-READS

test('a strictly newer file mtime is changed (re-read)', () => {
  assert.equal(configIsUnchanged(200, 50, 100, 50), false)
})

test('an older file mtime is unchanged — cache already at/after it (skip)', () => {
  assert.equal(configIsUnchanged(100, 50, 200, 50), true)
})

test('the file-gone callback (curr.mtimeMs === 0) is unchanged (skip)', () => {
  // watchFile fires with mtimeMs=0 on deletion / initial; cacheMtime is a real
  // (or overshoot) value, so 0 < cacheMtime → skip, matching the old `<=` gate.
  assert.equal(configIsUnchanged(0, 0, 1_700_000_000_000, 50), true)
})

// --- the same-tick discriminator: SIZE ---

test('equal mtime + equal size = our own write (skip)', () => {
  // stat-after-write stores the real mtime+size; the watcher re-stats the same
  // file and sees the identical pair → skip without re-reading our own write.
  assert.equal(configIsUnchanged(100, 512, 100, 512), true)
})

test('equal mtime + DIFFERENT size = a same-tick external write (re-read)', () => {
  // THE BUG FIX: a coarse-mtime FS (or a same-second other-instance write) lands
  // on the same mtime tick. The old `<=` gate shadowed it; the size tiebreak now
  // forces a re-read so the external update is not silently served stale.
  assert.equal(configIsUnchanged(100, 999, 100, 512), false)
  assert.equal(configIsUnchanged(100, 0, 100, 512), false)
})

// --- size-unknown fallback preserves the old mtime-only `<=` behavior ---

test('equal mtime with no cached size falls back to skip (old <= behavior)', () => {
  // write-through whose post-write stat failed: cacheMtime is a clock value with
  // no paired size. With nothing to tiebreak, an equal mtime is treated as our
  // own write → skip, exactly as the pre-fix `curr.mtimeMs <= cache.mtime` did.
  assert.equal(configIsUnchanged(100, 50, 100, null), true)
  assert.equal(configIsUnchanged(100, 50, 100, undefined), true)
})

test('a newer mtime still re-reads even with no cached size', () => {
  assert.equal(configIsUnchanged(200, 50, 100, null), false)
})

test('a non-numeric current size at an equal tick falls back to skip', () => {
  // defensive: a stat that somehow yields a non-number size cannot tiebreak.
  assert.equal(configIsUnchanged(100, undefined, 100, 512), true)
})
