import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, stat, rm, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { reclaimAbandonedSnapshotStoresCore } from '../src/services/snapshot/reclaimStores.mjs'

const DAY = 24 * 60 * 60 * 1000
// FsOperations-shaped adapter over node:fs/promises (readdir → Dirent[]).
const fsImpl = { readdir: (p, opts) => readdir(p, opts), stat, rm }

async function makeStore(base, name, { manifest, dirAgeMs } = {}) {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  if (manifest !== undefined) await writeFile(join(dir, 'manifest.json'), manifest)
  if (dirAgeMs !== undefined) {
    const when = new Date(Date.now() - dirAgeMs) // backdate AFTER writing files
    await utimes(dir, when, when)
  }
  return dir
}

test('reclaims a store whose newest manifest timestamp is older than the cutoff, keeps recent ones', async () => {
  const base = await mkdtemp(join(tmpdir(), 'snap-reclaim-'))
  const old = Date.now() - 40 * DAY
  const recent = Date.now() - 1 * DAY
  await makeStore(base, 'hashOLD', {
    manifest: JSON.stringify([{ timestamp: old - DAY }, { timestamp: old }]),
  })
  await makeStore(base, 'hashRECENT', {
    // newest entry is recent even though an older one exists → store is alive
    manifest: JSON.stringify([{ timestamp: old }, { timestamp: recent }]),
  })

  const result = await reclaimAbandonedSnapshotStoresCore({
    baseDir: base,
    cutoffMs: Date.now() - 30 * DAY,
    fs: fsImpl,
  })

  assert.equal(result.messages, 1)
  assert.equal(result.errors, 0)
  assert.equal(existsSync(join(base, 'hashOLD')), false, 'abandoned store reclaimed')
  assert.equal(existsSync(join(base, 'hashRECENT')), true, 'recently-active store kept')
})

test('falls back to dir mtime when the manifest is missing / empty / corrupt', async () => {
  const base = await mkdtemp(join(tmpdir(), 'snap-reclaim-'))
  await makeStore(base, 'noManifestOld', { dirAgeMs: 40 * DAY })
  await makeStore(base, 'noManifestFresh', { dirAgeMs: 60 * 60 * 1000 })
  await makeStore(base, 'emptyManifestOld', { manifest: '[]', dirAgeMs: 40 * DAY })
  await makeStore(base, 'corruptOld', { manifest: '{ not json', dirAgeMs: 40 * DAY })

  const result = await reclaimAbandonedSnapshotStoresCore({
    baseDir: base,
    cutoffMs: Date.now() - 30 * DAY,
    fs: fsImpl,
  })

  assert.equal(result.messages, 3, 'the 3 old manifest-less/empty/corrupt stores reclaimed via mtime')
  assert.equal(existsSync(join(base, 'noManifestOld')), false)
  assert.equal(existsSync(join(base, 'emptyManifestOld')), false)
  assert.equal(existsSync(join(base, 'corruptOld')), false)
  // a fresh store with no manifest yet must NOT be reclaimed on a 0 timestamp
  assert.equal(existsSync(join(base, 'noManifestFresh')), true)
})

test('ignores non-directory entries and is a no-op when the base dir is absent', async () => {
  const base = await mkdtemp(join(tmpdir(), 'snap-reclaim-'))
  await writeFile(join(base, 'stray.txt'), 'x')
  const r1 = await reclaimAbandonedSnapshotStoresCore({
    baseDir: base,
    cutoffMs: Date.now() - 30 * DAY,
    fs: fsImpl,
  })
  assert.deepEqual(r1, { messages: 0, errors: 0 })
  assert.equal(existsSync(join(base, 'stray.txt')), true, 'a stray file is never removed')

  const missing = join(tmpdir(), 'snap-reclaim-missing-' + process.pid)
  const r2 = await reclaimAbandonedSnapshotStoresCore({
    baseDir: missing,
    cutoffMs: Date.now(),
    fs: fsImpl,
  })
  assert.deepEqual(r2, { messages: 0, errors: 0 })
})

test('counts a per-store rm failure without aborting the rest', async () => {
  const base = await mkdtemp(join(tmpdir(), 'snap-reclaim-'))
  await makeStore(base, 'storeA', { dirAgeMs: 40 * DAY })
  await makeStore(base, 'storeB', { dirAgeMs: 40 * DAY })
  const flaky = {
    ...fsImpl,
    rm: async (p, opts) => {
      if (p.endsWith('storeA')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return rm(p, opts)
    },
  }

  const result = await reclaimAbandonedSnapshotStoresCore({
    baseDir: base,
    cutoffMs: Date.now() - 30 * DAY,
    fs: flaky,
  })

  assert.equal(result.errors, 1, 'the failing rm is counted, not thrown')
  assert.equal(result.messages, 1, 'the other store is still reclaimed')
  assert.equal(existsSync(join(base, 'storeB')), false)
})
