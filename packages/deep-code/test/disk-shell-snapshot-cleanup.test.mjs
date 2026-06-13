import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readdir, stat, unlink, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanupOldShellSnapshotsCore } from '../src/utils/shellSnapshotCleanup.mjs'

// FsOperations-shaped adapter over node:fs/promises (readdir → Dirent[], like
// cleanup.ts's getFsImplementation()).
const fsImpl = {
  readdir: p => readdir(p, { withFileTypes: true }),
  stat,
  unlink,
}

const DAY = 24 * 60 * 60 * 1000

async function writeBackdated(path, ageMs) {
  await writeFile(path, '# fake shell snapshot\n')
  const when = new Date(Date.now() - ageMs)
  await utimes(path, when, when)
}

test('cleanupOldShellSnapshotsCore removes only old snapshot-*.sh files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shell-snap-'))
  // Old snapshots (40 days) — must be reclaimed.
  await writeBackdated(join(dir, 'snapshot-bash-20260101-aaaa.sh'), 40 * DAY)
  await writeBackdated(join(dir, 'snapshot-zsh-20260102-bbbb.sh'), 40 * DAY)
  // Fresh snapshot (1 hour) — must be kept.
  await writeBackdated(join(dir, 'snapshot-bash-20260613-cccc.sh'), 60 * 60 * 1000)
  // Non-snapshot files — must NEVER be touched, even when old.
  await writeBackdated(join(dir, 'notes.sh'), 40 * DAY) // .sh but no snapshot- prefix
  await writeBackdated(join(dir, 'snapshot-bash-old.txt'), 40 * DAY) // snapshot- prefix but not .sh
  await writeBackdated(join(dir, 'keep.json'), 40 * DAY)

  const cutoff = new Date(Date.now() - 30 * DAY)
  const result = await cleanupOldShellSnapshotsCore(dir, cutoff, fsImpl)

  assert.equal(result.messages, 2, 'both old snapshots removed')
  assert.equal(result.errors, 0)
  assert.equal(existsSync(join(dir, 'snapshot-bash-20260101-aaaa.sh')), false)
  assert.equal(existsSync(join(dir, 'snapshot-zsh-20260102-bbbb.sh')), false)
  // fresh + non-matching files survive
  assert.equal(existsSync(join(dir, 'snapshot-bash-20260613-cccc.sh')), true)
  assert.equal(existsSync(join(dir, 'notes.sh')), true)
  assert.equal(existsSync(join(dir, 'snapshot-bash-old.txt')), true)
  assert.equal(existsSync(join(dir, 'keep.json')), true)
})

test('cleanupOldShellSnapshotsCore is a no-op (no throw) when the directory does not exist', async () => {
  const missing = join(tmpdir(), 'shell-snap-does-not-exist-' + process.pid)
  const result = await cleanupOldShellSnapshotsCore(missing, new Date(), fsImpl)
  assert.deepEqual(result, { messages: 0, errors: 0 })
})

test('cleanupOldShellSnapshotsCore counts a per-file failure without aborting the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shell-snap-err-'))
  await writeBackdated(join(dir, 'snapshot-bash-1-aaaa.sh'), 40 * DAY)
  await writeBackdated(join(dir, 'snapshot-bash-2-bbbb.sh'), 40 * DAY)

  // unlink throws for the first file only — the loop must record an error and
  // still reclaim the second.
  let firstSeen = false
  const flakyFs = {
    ...fsImpl,
    unlink: async p => {
      if (!firstSeen && p.endsWith('snapshot-bash-1-aaaa.sh')) {
        firstSeen = true
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      }
      return unlink(p)
    },
  }
  const cutoff = new Date(Date.now() - 30 * DAY)
  const result = await cleanupOldShellSnapshotsCore(dir, cutoff, flakyFs)

  assert.equal(result.errors, 1, 'the failing unlink is counted, not thrown')
  assert.equal(result.messages, 1, 'the other snapshot is still reclaimed')
  assert.equal(existsSync(join(dir, 'snapshot-bash-2-bbbb.sh')), false)
})
