import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  checkAndPrune,
  getSnapshotStoreSize,
} from '../src/services/snapshot/diskCap.mjs'
import { acquireLock } from '../src/services/snapshot/lock.mjs'
import { runSideGit } from '../src/services/snapshot/storeInit.mjs'
import {
  appendManifest,
  readManifest,
} from '../src/services/snapshot/manifest.mjs'
import {
  computeWorkspaceHash,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  resolveSnapshotStore,
} from '../src/services/snapshot/index.mjs'
import {
  buildSnapshotTurnId,
  captureTurnSnapshot,
  formatSnapshotLifecycleError,
  getTurnEndSnapshotPhase,
  nextSnapshotTurnId,
} from '../src/services/snapshot/turnLifecycle.mjs'
import {
  formatRestoreSnapshotLine,
  getRestoreSnapshotItems,
  performRestore,
} from '../src/commands/restore/restore-command.mjs'
import {
  buildRevertTurnPermissionResult,
  formatRevertTurnResult,
  performRevertTurn,
  resolveRevertTurnSnapshot,
  validateRevertTurnInput,
} from '../src/tools/RevertTurnTool/revert-turn.mjs'

test('computeWorkspaceHash is deterministic for the same path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-hash-'))

  assert.equal(
    computeWorkspaceHash(workspaceRoot),
    computeWorkspaceHash(resolve(workspaceRoot)),
  )
})

test('computeWorkspaceHash distinguishes different paths', async () => {
  const first = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-a-'))
  const second = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-b-'))

  assert.notEqual(computeWorkspaceHash(first), computeWorkspaceHash(second))
})

test('resolveSnapshotStore returns expected store sub-paths', async () => {
  await withDeepCodeHome(async home => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-store-'))
    const workspaceHash = computeWorkspaceHash(workspaceRoot)
    const store = resolveSnapshotStore({ workspaceRoot })

    assert.equal(store.workspaceHash, workspaceHash)
    assert.equal(store.storePath, join(home, 'snapshots', workspaceHash))
    assert.equal(store.gitDir, join(store.storePath, '.git'))
    assert.equal(store.manifestPath, join(store.storePath, 'manifest.json'))
  })
})

test('createSnapshot initializes side-git for a non-git workspace', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-nongit-'))
    await writeFile(join(workspaceRoot, 'hello.txt'), 'hello\n')

    const entry = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-1',
      phase: 'pre',
    })
    const store = resolveSnapshotStore({ workspaceRoot })

    assert.equal(existsSync(store.gitDir), true)
    assert.match(entry.commitSha, /^[0-9a-f]{40,64}$/)
    assert.equal(entry.turnId, 'turn-1')
    assert.equal(entry.phase, 'pre')
    assert.equal(entry.workspaceRoot, realpathSync.native(resolve(workspaceRoot)))
    assert.equal(entry.hashVersion, 1)
    assert.deepEqual(entry.changedFiles, ['hello.txt'])
    assert.deepEqual(await readManifest(store.manifestPath), [entry])
  })
})

test("createSnapshot works in a git workspace without touching user's .git", async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-git-'))
    runGit(['init'], workspaceRoot)
    await writeFile(join(workspaceRoot, 'tracked-by-side-git.txt'), 'content\n')

    const headPath = join(workspaceRoot, '.git', 'HEAD')
    const headBefore = readFileSync(headPath, 'utf8')
    const headMtimeBefore = statSync(headPath).mtimeMs
    const userIndexPath = join(workspaceRoot, '.git', 'index')
    const hadUserIndex = existsSync(userIndexPath)

    const entry = await createSnapshot({
      workspaceRoot,
      turnId: 2,
      phase: 'post',
    })

    assert.match(entry.commitSha, /^[0-9a-f]{40,64}$/)
    assert.equal(readFileSync(headPath, 'utf8'), headBefore)
    assert.equal(statSync(headPath).mtimeMs, headMtimeBefore)
    assert.equal(existsSync(userIndexPath), hadUserIndex)
  })
})

test('listSnapshots respects limit and returns recent entries in manifest order', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-list-'))
    await writeFile(join(workspaceRoot, 'file.txt'), 'v1\n')

    await createSnapshot({ workspaceRoot, turnId: 'turn-1', phase: 'pre' })
    await writeFile(join(workspaceRoot, 'file.txt'), 'v2\n')
    await createSnapshot({ workspaceRoot, turnId: 'turn-2', phase: 'post' })
    await writeFile(join(workspaceRoot, 'file.txt'), 'v3\n')
    await createSnapshot({ workspaceRoot, turnId: 'turn-3', phase: 'post' })

    assert.deepEqual(
      (await listSnapshots({ workspaceRoot, limit: 2 })).map(entry => entry.turnId),
      ['turn-2', 'turn-3'],
    )
  })
})

test('listSnapshots returns an empty array when no snapshots exist', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-empty-'))

    assert.deepEqual(await listSnapshots({ workspaceRoot }), [])
  })
})

test('manifest writes are atomic and ignore leftover tmp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-manifest-'))
  const manifestPath = join(dir, 'manifest.json')
  const entry = {
    turnId: 'turn-atomic',
    phase: 'pre',
    timestamp: 123,
    commitSha: 'a'.repeat(40),
    workspaceRoot: dir,
    hashVersion: 1,
    changedFiles: ['file.txt'],
  }

  await appendManifest(manifestPath, entry)
  await writeFile(`${manifestPath}.leftover.tmp`, '{"partial":')

  assert.deepEqual(await readManifest(manifestPath), [entry])
  assert.equal(
    readdirSync(dir).filter(name => /^manifest\.json\..*\.tmp$/.test(name))
      .length,
    1,
  )
})

test('readManifest degrades a corrupt manifest to [] then self-heals on the next append', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-corrupt-'))
  const manifestPath = join(dir, 'manifest.json')
  await writeFile(manifestPath, '[{"turnId":"t1","commitSha":"a')

  // Degrades instead of throwing. The bad file is left in place (not renamed):
  // an unlocked reader must never move a file a concurrent writer may be
  // healing — the atomic append below is what heals.
  assert.deepEqual(await readManifest(manifestPath), [])
  assert.equal(existsSync(manifestPath), true)

  // The next append atomically overwrites the corrupt file: a fresh manifest
  // with only the new entry.
  const entry = {
    turnId: 'turn-heal',
    phase: 'pre',
    timestamp: 7,
    commitSha: 'b'.repeat(40),
    workspaceRoot: dir,
    hashVersion: 1,
    changedFiles: [],
  }
  await appendManifest(manifestPath, entry)
  assert.deepEqual(await readManifest(manifestPath), [entry])
})

test('readManifest degrades a non-array manifest to []', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-nonarray-'))
  const manifestPath = join(dir, 'manifest.json')
  await writeFile(manifestPath, '{"not":"an array"}')

  assert.deepEqual(await readManifest(manifestPath), [])
})

test('checkAndPrune removes oldest snapshots when side-git exceeds cap', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-cap-'))
    for (let index = 1; index <= 3; index += 1) {
      await writeFile(
        join(workspaceRoot, 'large.txt'),
        `${index}:${'x'.repeat(200_000)}\n`,
      )
      await createSnapshot({
        workspaceRoot,
        turnId: `turn-${index}`,
        phase: 'post',
      })
    }

    const store = resolveSnapshotStore({ workspaceRoot })
    const beforeBytes = await getSnapshotStoreSize(store.storePath)
    const result = await checkAndPrune({
      workspaceRoot,
      capBytes: beforeBytes - 1,
    })
    const remainingTurns = (await listSnapshots({ workspaceRoot, limit: 10 })).map(
      entry => entry.turnId,
    )

    assert.ok(result.prunedCount >= 1)
    assert.ok(result.finalBytes <= beforeBytes - 1)
    assert.equal(remainingTurns.includes('turn-1'), false)
    assert.equal(remainingTurns.includes('turn-3'), true)
  })
})

test('checkAndPrune is a no-op when snapshot store is under cap', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-cap-ok-'))
    await writeFile(join(workspaceRoot, 'small.txt'), 'small\n')
    await createSnapshot({ workspaceRoot, turnId: 'turn-1', phase: 'pre' })

    const store = resolveSnapshotStore({ workspaceRoot })
    const beforeBytes = await getSnapshotStoreSize(store.storePath)
    const result = await checkAndPrune({
      workspaceRoot,
      capBytes: beforeBytes + 1024,
    })

    assert.deepEqual(result, { prunedCount: 0, finalBytes: beforeBytes })
    assert.equal((await listSnapshots({ workspaceRoot })).length, 1)
  })
})

const listSnapshotRefShas = async (store, workspaceRoot) =>
  (
    await runSideGit(store.gitDir, workspaceRoot, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/deepcode/snapshots/',
    ])
  )
    .split('\n')
    .map(ref => ref.trim())
    .filter(Boolean)
    .map(ref => ref.slice('refs/deepcode/snapshots/'.length))

const gitObjectExists = async (store, workspaceRoot, sha) => {
  try {
    await runSideGit(store.gitDir, workspaceRoot, ['cat-file', '-e', sha])
    return true
  } catch {
    return false
  }
}

test('checkAndPrune reclaims orphaned refs left by a healed manifest before evicting live snapshots', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'deepcode-snapshot-orphan-'),
    )
    for (let index = 1; index <= 3; index += 1) {
      await writeFile(
        join(workspaceRoot, 'large.txt'),
        `${index}:${'x'.repeat(200_000)}\n`,
      )
      await createSnapshot({ workspaceRoot, turnId: `turn-${index}`, phase: 'post' })
    }

    const store = resolveSnapshotStore({ workspaceRoot })
    const allEntries = await readManifest(store.manifestPath)
    assert.equal(allEntries.length, 3)
    assert.equal((await listSnapshotRefShas(store, workspaceRoot)).length, 3)

    // Simulate a corrupt -> heal: the rebuilt manifest lists only the newest
    // snapshot, while turn-1/turn-2 refs are stranded in the store.
    const liveEntry = allEntries.at(-1)
    const orphanShas = allEntries.slice(0, -1).map(entry => entry.commitSha)
    await writeFile(
      store.manifestPath,
      `${JSON.stringify([liveEntry], null, 2)}\n`,
    )

    const beforeBytes = await getSnapshotStoreSize(store.storePath)
    const result = await checkAndPrune({ workspaceRoot, capBytes: beforeBytes - 1 })

    // The two orphaned refs are reclaimed; the live one survives, and no LIVE
    // snapshot was evicted (reclaiming orphans alone got us back under cap).
    assert.deepEqual(await listSnapshotRefShas(store, workspaceRoot), [
      liveEntry.commitSha,
    ])
    assert.equal(result.prunedCount, 0)
    assert.ok(result.finalBytes < beforeBytes)
    assert.ok(result.finalBytes <= beforeBytes - 1)
    assert.deepEqual(
      (await listSnapshots({ workspaceRoot })).map(entry => entry.turnId),
      [liveEntry.turnId],
    )

    // Real object-store reclamation, not just ref-file deletion: the orphaned
    // commit objects are pruned from the store, while the live one is intact.
    // (git compresses the blobs, so a byte-size delta alone would be a weak,
    // near-false-green signal — assert the objects themselves are gone.)
    for (const sha of orphanShas) {
      assert.equal(await gitObjectExists(store, workspaceRoot, sha), false)
    }
    assert.equal(
      await gitObjectExists(store, workspaceRoot, liveEntry.commitSha),
      true,
    )
  })
})

test('checkAndPrune never wipes refs when the manifest read is empty (corrupt-degraded)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'deepcode-snapshot-orphan-guard-'),
    )
    for (let index = 1; index <= 2; index += 1) {
      await writeFile(
        join(workspaceRoot, 'large.txt'),
        `${index}:${'x'.repeat(200_000)}\n`,
      )
      await createSnapshot({ workspaceRoot, turnId: `turn-${index}`, phase: 'post' })
    }

    const store = resolveSnapshotStore({ workspaceRoot })
    // A still-corrupt manifest degrades readManifest to []. The empty read must
    // NOT be treated as "every ref is an orphan" and wipe the whole store.
    await writeFile(store.manifestPath, 'not json{')

    const beforeBytes = await getSnapshotStoreSize(store.storePath)
    const result = await checkAndPrune({ workspaceRoot, capBytes: beforeBytes - 1 })

    assert.equal((await listSnapshotRefShas(store, workspaceRoot)).length, 2)
    assert.equal(result.prunedCount, 0)
  })
})

test('acquireLock queues same-process contenders', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-lock-'))
    const first = await acquireLock({ workspaceRoot })
    let secondAcquired = false
    const secondPromise = acquireLock({ workspaceRoot, timeoutMs: 1000 }).then(
      lock => {
        secondAcquired = true
        return lock
      },
    )

    await delay(50)
    assert.equal(secondAcquired, false)

    await first.release()
    const second = await secondPromise
    assert.equal(secondAcquired, true)
    await second.release()
  })
})

test('acquireLock recovers stale lock files', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-stale-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    await writeFile(
      join(store.storePath, 'snapshot.lock'),
      JSON.stringify({
        ownerId: 'stale-owner',
        pid: 99999999,
        ts: 0,
        hostname: 'stale-host',
      }),
    )

    const lock = await acquireLock({ workspaceRoot, timeoutMs: 1000, staleMs: 0 })

    assert.notEqual(lock.ownerId, 'stale-owner')
    await lock.release()
  })
})

test('acquireLock recovers a crashed holder whose pid was recycled to a live process', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-recycled-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    // A crashed holder's lock whose pid now belongs to a LIVE process (our
    // own pid — maximally alive). The old pid-AND-TTL rule never recovered
    // this: every acquisition stalled the full timeout, forever.
    await writeFile(
      join(store.storePath, 'snapshot.lock'),
      JSON.stringify({
        ownerId: 'crashed-owner',
        pid: process.pid,
        ts: Date.now() - 1_000,
        hostname: hostname(),
      }),
    )

    const started = Date.now()
    const lock = await acquireLock({ workspaceRoot, timeoutMs: 5_000, staleMs: 500 })
    assert.ok(Date.now() - started < 2_000, 'TTL recovery must not wait out the timeout')
    assert.notEqual(lock.ownerId, 'crashed-owner')
    await lock.release()
  })
})

test('acquireLock fast-recovers a dead same-host pid without waiting out the TTL', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-deadpid-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    // Fresh ts (well inside the default 60s TTL) but a dead pid on THIS host.
    await writeFile(
      join(store.storePath, 'snapshot.lock'),
      JSON.stringify({
        ownerId: 'dead-owner',
        pid: 99_999_999,
        ts: Date.now(),
        hostname: hostname(),
      }),
    )

    const lock = await acquireLock({ workspaceRoot, timeoutMs: 1_000 })
    assert.notEqual(lock.ownerId, 'dead-owner')
    await lock.release()
  })
})

test('acquireLock does not trust a dead pid recorded by a FOREIGN host', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-foreign-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    // Fresh foreign-host lock: its pid is meaningless locally, so neither the
    // fast path nor the TTL applies yet — acquisition must wait (time out).
    await writeFile(
      join(store.storePath, 'snapshot.lock'),
      JSON.stringify({
        ownerId: 'foreign-owner',
        pid: 99_999_999,
        ts: Date.now(),
        hostname: 'some-other-host',
      }),
    )

    await assert.rejects(
      () => acquireLock({ workspaceRoot, timeoutMs: 300 }),
      /Timed out acquiring snapshot lock/,
    )
  })
})

test('a held lock refreshes its timestamp so TTL recovery cannot steal it', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-refresh-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    // A generous TTL keeps the test robust on loaded CI runners: the
    // refresher fires every staleMs/3, so the recorded ts is always well
    // inside the TTL by construction. The fragile part is asserting that
    // against the WALL CLOCK (Date.now() - ts), which races scheduling
    // jitter — so the freshness is proven by SAMPLING the file twice and
    // showing ts keeps advancing (the refresher is alive), not by a
    // wall-clock deadline.
    const staleMs = 600
    const lock = await acquireLock({ workspaceRoot, staleMs })
    const lockPath = join(store.storePath, 'snapshot.lock')
    const initial = JSON.parse(readFileSync(lockPath, 'utf8'))

    // Hold past two refresh intervals and confirm ts advanced...
    await delay(staleMs)
    const firstSample = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(firstSample.ownerId, initial.ownerId)
    assert.ok(firstSample.ts > initial.ts, 'ts must advance while held')

    // ...and again, proving the refresher is actively running rather than
    // having fired once and stopped (which would let the TTL lapse).
    await delay(staleMs)
    const secondSample = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(secondSample.ownerId, initial.ownerId)
    assert.ok(
      secondSample.ts > firstSample.ts,
      'the refresher must keep advancing ts, not stop after one tick',
    )
    await lock.release()
  })
})

test('the refresher stops instead of clobbering a lock that changed hands', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-stolen-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    const lock = await acquireLock({ workspaceRoot, staleMs: 90 })
    const lockPath = join(store.storePath, 'snapshot.lock')
    const foreign = {
      ownerId: 'thief-owner',
      pid: process.pid,
      ts: Date.now(),
      hostname: hostname(),
    }
    await writeFile(lockPath, JSON.stringify(foreign))

    await delay(250)
    const current = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(current.ownerId, 'thief-owner', 'stolen lock must not be clobbered back')
    await assert.rejects(lock.release(), /Lock ownership changed/)
  })
})

test('acquireLock recovers an UNREADABLE lock once its file stops changing for a TTL', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-corruptlock-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    const lockPath = join(store.storePath, 'snapshot.lock')
    // A crash mid-write can leave the lock unparseable; its CONTENTS will
    // never heal, so recovery keys off the file's mtime instead.
    await writeFile(lockPath, '{"ownerId": "trunc')
    const past = new Date(Date.now() - 10_000)
    await utimes(lockPath, past, past)

    const lock = await acquireLock({ workspaceRoot, timeoutMs: 2_000, staleMs: 500 })
    assert.ok(lock.ownerId)
    await lock.release()
  })
})

test('acquireLock leaves a FRESH unreadable lock alone (mid-creation window)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-freshcorrupt-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    // Fresh mtime: could be another process between open('wx') and its first
    // metadata write — must NOT be stolen.
    await writeFile(join(store.storePath, 'snapshot.lock'), 'not json yet')

    await assert.rejects(
      () => acquireLock({ workspaceRoot, timeoutMs: 300 }),
      /Timed out acquiring snapshot lock/,
    )
  })
})

test('release leaves no zombie lock behind an in-flight refresh tick', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-zombie-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    const lockPath = join(store.storePath, 'snapshot.lock')
    // Tight ticks maximize the chance a refresh is mid-write at release time;
    // release must await the in-flight tick so the unlink is final.
    for (let round = 0; round < 25; round += 1) {
      const lock = await acquireLock({ workspaceRoot, staleMs: 30 })
      await delay(12)
      await lock.release()
      assert.equal(existsSync(lockPath), false, `zombie lock after round ${round}`)
      await delay(15)
      assert.equal(
        existsSync(lockPath),
        false,
        `lock re-created by a stray refresh after round ${round}`,
      )
    }
  })
})

test('an orphaned reaper claim is reclaimed by mtime so recovery cannot wedge', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-reaper-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    const lockPath = join(store.storePath, 'snapshot.lock')
    // A stale lock AND an orphaned reaper claim (a recoverer crashed between
    // claiming and reaping). The orphan blocks recovery until its own mtime
    // ages a TTL — then recovery proceeds.
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerId: 'crashed-owner',
        pid: 99_999_999,
        ts: Date.now() - 10_000,
        hostname: hostname(),
      }),
    )
    await writeFile(`${lockPath}.reaper`, '')
    const past = new Date(Date.now() - 10_000)
    await utimes(`${lockPath}.reaper`, past, past)

    const lock = await acquireLock({ workspaceRoot, timeoutMs: 2_000, staleMs: 500 })
    assert.ok(lock.ownerId)
    assert.equal(existsSync(`${lockPath}.reaper`), false)
    await lock.release()
  })
})

test('a FRESH foreign reaper claim defers recovery instead of racing it', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-freshreaper-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    await mkdir(store.storePath, { recursive: true })
    const lockPath = join(store.storePath, 'snapshot.lock')
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerId: 'crashed-owner',
        pid: 99_999_999,
        ts: Date.now() - 10_000,
        hostname: hostname(),
      }),
    )
    // Another process is reaping RIGHT NOW (fresh claim): we must not race it.
    await writeFile(
      `${lockPath}.reaper`,
      JSON.stringify({ ownerId: 'other-recoverer', claimedAt: Date.now() }),
    )

    await assert.rejects(
      () => acquireLock({ workspaceRoot, timeoutMs: 300, staleMs: 5_000 }),
      /Timed out acquiring snapshot lock/,
    )
  })
})

test('a holder wedged past the TTL leaves its lock for the reaper instead of unlinking', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-forfeitrel-'))
    const store = resolveSnapshotStore({ workspaceRoot })
    const lockPath = join(store.storePath, 'snapshot.lock')
    const lock = await acquireLock({ workspaceRoot, staleMs: 1_000 })
    // Wedge the event loop past max(staleMs, 1s): no refresh ticks can run,
    // exactly like a long process pause. A recoverer elsewhere may already
    // have VERIFIED this lock as stale — our unlink would hand the path to a
    // third process mid-reap.
    const wedgeUntil = Date.now() + 1_100
    while (Date.now() < wedgeUntil) {
      // busy-wait: simulates SIGSTOP/VM freeze for the liveness gap
    }
    await lock.release()
    // The lock file must STILL exist (release skipped the unlink)...
    assert.equal(existsSync(lockPath), true)
    // ...and the next acquisition reaps it immediately (ts already past TTL).
    const next = await acquireLock({ workspaceRoot, timeoutMs: 3_000, staleMs: 1_000 })
    assert.notEqual(next.ownerId, lock.ownerId)
    await next.release()
    assert.equal(existsSync(lockPath), false)
  })
})

test('acquireLock refuses release after lock ownership changes', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-owner-'))
    const lock = await acquireLock({ workspaceRoot })
    const store = resolveSnapshotStore({ workspaceRoot })
    await writeFile(
      join(store.storePath, 'snapshot.lock'),
      JSON.stringify({
        ownerId: 'other-owner',
        pid: process.pid,
        ts: Date.now(),
        hostname: hostname(),
      }),
    )

    await assert.rejects(lock.release(), /Lock ownership changed/)
  })
})

test('turn lifecycle helper captures one pre and one post snapshot per turn', async () => {
  const calls = []
  const createSnapshotFn = async input => {
    calls.push(input)
    return { ...input, commitSha: 'a'.repeat(40) }
  }
  const workspaceRoot = '/tmp/deepcode-turn-lifecycle'
  const turnId = 'turn-life'

  assert.equal(
    (await captureTurnSnapshot({
      workspaceRoot,
      turnId,
      phase: 'pre',
      createSnapshotFn,
    })).ok,
    true,
  )
  assert.equal(
    (await captureTurnSnapshot({
      workspaceRoot,
      turnId,
      phase: 'post',
      createSnapshotFn,
    })).ok,
    true,
  )
  assert.deepEqual(calls, [
    { workspaceRoot, turnId, phase: 'pre' },
    { workspaceRoot, turnId, phase: 'post' },
  ])
})

test('turn lifecycle helper maps canceled turns to aborted snapshots', () => {
  assert.equal(getTurnEndSnapshotPhase({ aborted: false }), 'post')
  assert.equal(getTurnEndSnapshotPhase({ aborted: true }), 'aborted')
})

test('turn lifecycle helper reports snapshot errors without throwing', async () => {
  const errors = []
  const result = await captureTurnSnapshot({
    workspaceRoot: '/tmp/deepcode-turn-error',
    turnId: 'turn-error',
    phase: 'pre',
    createSnapshotFn: async () => {
      throw new Error('disk unavailable')
    },
    onError: error => errors.push(error),
  })

  assert.equal(result.ok, false)
  assert.equal(errors.length, 1)
  assert.match(formatSnapshotLifecycleError(errors[0]), /disk unavailable/)
})

test('buildSnapshotTurnId always keys by generation so revert_turn turn_id can match', () => {
  // An earlier revision preferred the first message uuid — which made every
  // live snapshot unmatchable by revert_turn's numeric grammar ("N"/"turn-N").
  assert.equal(
    buildSnapshotTurnId({
      generation: 7,
      messages: [{ uuid: 'message-uuid' }],
    }),
    'turn-7',
  )
  assert.equal(buildSnapshotTurnId({ generation: 8 }), 'turn-8')
})

test('resolveRevertTurnSnapshot prefers same-session matches over a newer foreign session', async () => {
  const listSnapshotsFn = async () => [
    { turnId: 'turn-2', phase: 'pre', commitSha: 'aaa', sessionId: 'session-old' },
    { turnId: 'turn-2', phase: 'pre', commitSha: 'bbb', sessionId: 'session-current' },
    { turnId: 'turn-2', phase: 'pre', commitSha: 'ccc', sessionId: 'session-other' },
  ]
  const selected = await resolveRevertTurnSnapshot({
    turnId: 2,
    sessionId: 'session-current',
    listSnapshotsFn,
  })
  assert.equal(selected.commitSha, 'bbb')
})

test('revert_turn never restores a FOREIGN session snapshot for a turn this session lacks', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-foreign-revert-'))
    const target = join(workspaceRoot, 'app.js')
    // Session B (an earlier run in this workspace) reached turn 5.
    await writeFile(target, 'SESSION-B content before turn 5\n')
    await createSnapshot({
      workspaceRoot,
      turnId: 'turn-5',
      phase: 'pre',
      sessionId: 'session-b',
    })
    // Session A only reached turn 1.
    await writeFile(target, 'SESSION-A live work\n')
    await createSnapshot({
      workspaceRoot,
      turnId: await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      phase: 'pre',
      sessionId: 'session-a',
    })

    // The model miscounts and asks for turn 5: that turn does not exist in
    // session A, and restoring B's turn-5 would overwrite A's live work.
    await assert.rejects(
      () =>
        performRevertTurn({
          workspaceRoot,
          sessionId: 'session-a',
          input: { turn_id: 5 },
        }),
      /No snapshot found for turn 5/,
    )
    assert.equal(readFileSync(target, 'utf8'), 'SESSION-A live work\n')
  })
})

test('resolveRevertTurnSnapshot falls back to newest match when no entry carries the session', async () => {
  // Entries written before sessionId was recorded must stay revertable.
  const listSnapshotsFn = async () => [
    { turnId: 'turn-3', phase: 'pre', commitSha: 'old' },
    { turnId: 'turn-3', phase: 'pre', commitSha: 'new' },
  ]
  const selected = await resolveRevertTurnSnapshot({
    turnId: 3,
    sessionId: 'session-current',
    listSnapshotsFn,
  })
  assert.equal(selected.commitSha, 'new')
})

test('nextSnapshotTurnId continues the session numbering across process restarts and resume', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-next-turn-'))
    // Fresh session, empty manifest → turn-1.
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      'turn-1',
    )
    await writeFile(join(workspaceRoot, 'app.js'), 'v1\n')
    for (let turn = 1; turn <= 3; turn += 1) {
      await createSnapshot({
        workspaceRoot,
        turnId: `turn-${turn}`,
        phase: 'pre',
        sessionId: 'session-a',
      })
    }
    // A restarted process (--resume) or /resume derives the NEXT ordinal from
    // the manifest, not from its restarted local counter.
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      'turn-4',
    )
    // Another session's numbering is independent.
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-b' }),
      'turn-1',
    )
  })
})

test('nextSnapshotTurnId stays monotonic past pruned-prefix and legacy uuid entries', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-next-prune-'))
    const readManifestFn = async () => [
      { turnId: 'a2c4e6f8-uuid-legacy', phase: 'pre', sessionId: 'session-a' },
      // turns 1-3 pruned by diskCap; only 4 and 5 survive
      { turnId: 'turn-4', phase: 'pre', sessionId: 'session-a' },
      { turnId: 'turn-5', phase: 'pre', sessionId: 'session-a' },
      { turnId: 'turn-9', phase: 'pre', sessionId: 'session-other' },
    ]
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a', readManifestFn }),
      'turn-6',
    )
  })
})

test('concurrent issuance for two sessions keeps both reservations (no lost update)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-ordinal-race-'))
    // Unserialized, both reads happen before either write and the second
    // write drops the first session's reservation last-writer-wins; the
    // snapshot-lock serialization makes both land.
    const [a, b] = await Promise.all([
      nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-b' }),
    ])
    assert.equal(a, 'turn-1')
    assert.equal(b, 'turn-1')
    // Both high-water marks must have survived: the next issuance for each
    // session continues from its own reservation.
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      'turn-2',
    )
    assert.equal(
      await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-b' }),
      'turn-2',
    )
  })
})

test('a tampered ordinal file value cannot produce an unmatchable turn key', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-ordinal-tamper-'))
    await createSnapshot({
      workspaceRoot,
      turnId: 'turn-2',
      phase: 'pre',
      sessionId: 'session-a',
    })
    const store = resolveSnapshotStore({ workspaceRoot })
    for (const tampered of [
      '{"session-a": 1e99}',
      '{"session-a": "999abc"}',
      '{"session-a": -5}',
      '[]',
      'null',
      'garbage{{',
    ]) {
      await writeFile(join(store.storePath, 'turn-ordinals.json'), tampered)
      assert.equal(
        await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
        'turn-3',
        `tampered value ${tampered} must degrade to the manifest floor`,
      )
    }
  })
})

test('an issued ordinal is consumed even when the turn never persists a snapshot', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-reserve-'))
    const target = join(workspaceRoot, 'app.js')
    // Turns 1-2 snapshot normally.
    const shas = {}
    for (let turn = 1; turn <= 2; turn += 1) {
      await writeFile(target, `before turn ${turn}\n`)
      const entry = await createSnapshot({
        workspaceRoot,
        turnId: await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
        phase: 'pre',
        sessionId: 'session-a',
      })
      shas[turn] = entry.commitSha
    }

    // Transcript turn 3: the ordinal is ISSUED but the snapshot fails — no
    // manifest entry is ever written for it.
    const failedTurnId = await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' })
    assert.equal(failedTurnId, 'turn-3')

    // Transcript turn 4 must NOT reuse turn-3: a reused number would make
    // revert_turn({turn_id: 3}) silently restore the wrong turn.
    await writeFile(target, 'before turn 4\n')
    const fourth = await createSnapshot({
      workspaceRoot,
      turnId: await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      phase: 'pre',
      sessionId: 'session-a',
    })
    assert.equal(fourth.turnId, 'turn-4')

    // The missing turn fails CLEANLY instead of mis-targeting.
    await assert.rejects(
      () =>
        performRevertTurn({
          workspaceRoot,
          sessionId: 'session-a',
          input: { turn_id: 3 },
        }),
      /No snapshot found for turn 3/,
    )
    const result = await performRevertTurn({
      workspaceRoot,
      sessionId: 'session-a',
      input: { turn_id: 2 },
    })
    assert.equal(result.snapshotId, shas[2])
  })
})

test('revert_turn after /resume targets the original turn, not a renumbered duplicate', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-resume-revert-'))
    const target = join(workspaceRoot, 'app.js')
    // Session A: turns 1-3, each changing the file.
    const turnShas = {}
    for (let turn = 1; turn <= 3; turn += 1) {
      await writeFile(target, `content before turn ${turn}\n`)
      const entry = await createSnapshot({
        workspaceRoot,
        turnId: await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
        phase: 'pre',
        sessionId: 'session-a',
      })
      turnShas[turn] = entry.commitSha
    }
    assert.equal(turnShas[3] !== undefined, true)

    // The user resumes session A in a NEW process (restarted local counter).
    // The next snapshot must be turn-4 — a restarted generation counter would
    // have written a colliding turn-1 and shadowed the original.
    await writeFile(target, 'content before resumed turn\n')
    const resumed = await createSnapshot({
      workspaceRoot,
      turnId: await nextSnapshotTurnId({ workspaceRoot, sessionId: 'session-a' }),
      phase: 'pre',
      sessionId: 'session-a',
    })
    assert.equal(resumed.turnId, 'turn-4')

    // revert_turn({turn_id: 2}) resolves to the ORIGINAL turn 2 snapshot.
    const result = await performRevertTurn({
      workspaceRoot,
      sessionId: 'session-a',
      input: { turn_id: 2 },
    })
    assert.equal(result.snapshotId, turnShas[2])
    assert.equal(
      readFileSync(target, 'utf8'),
      'content before turn 2\n',
    )
  })
})

test('a REPL-shaped snapshot (generation key + sessionId) is revertable by numeric turn_id end-to-end', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-revert-e2e-'))
    await writeFile(join(workspaceRoot, 'app.js'), 'orig\n')
    // The exact shape the REPL writes: buildSnapshotTurnId + sessionId rider.
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: buildSnapshotTurnId({ generation: 2 }),
      phase: 'pre',
      sessionId: 'session-e2e',
    })
    assert.equal(snapshot.turnId, 'turn-2')
    assert.equal(snapshot.sessionId, 'session-e2e')

    await writeFile(join(workspaceRoot, 'app.js'), 'botched by the model\n')
    const result = await performRevertTurn({
      workspaceRoot,
      sessionId: 'session-e2e',
      input: { turn_id: 2 },
    })
    assert.equal(result.snapshotId, snapshot.commitSha)
    assert.equal(readFileSync(join(workspaceRoot, 'app.js'), 'utf8'), 'orig\n')
  })
})

test('restore command lists the latest ten snapshots newest first', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-list-'))
    for (let index = 1; index <= 12; index += 1) {
      await writeFile(join(workspaceRoot, 'file.txt'), `v${index}\n`)
      await createSnapshot({
        workspaceRoot,
        turnId: `turn-${index}`,
        phase: index % 2 === 0 ? 'post' : 'pre',
      })
    }

    const items = await getRestoreSnapshotItems({ workspaceRoot })

    assert.equal(items.length, 10)
    assert.equal(items[0].turnId, 'turn-12')
    assert.equal(items[9].turnId, 'turn-3')
    assert.match(formatRestoreSnapshotLine(items[0]), /turn-12/)
    assert.match(formatRestoreSnapshotLine(items[0]), /1 file/)
  })
})

test('restore command reports empty snapshot stores', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-empty-'))

    const items = await getRestoreSnapshotItems({ workspaceRoot })

    assert.deepEqual(items, [])
  })
})

test('restoreSnapshot restores tracked workspace content from a side-git snapshot', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-roundtrip-'))
    const filePath = join(workspaceRoot, 'tracked.txt')
    await writeFile(filePath, 'before\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-restore',
      phase: 'pre',
    })
    await writeFile(filePath, 'after\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    assert.equal(readFileSync(filePath, 'utf8'), 'before\n')
    assert.equal(result.snapshotId, snapshot.commitSha)
    assert.equal(result.affectedFileCount, 1)
  })
})

test('restoreSnapshot deletes files created after the snapshot and re-creates deleted ones (faithful restore)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-delete-'))
    await writeFile(join(workspaceRoot, 'kept.txt'), 'original\n')
    await writeFile(join(workspaceRoot, 'removed-by-turn.txt'), 'should come back\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-del',
      phase: 'pre',
    })
    // the turn modifies a file, deletes one, and creates a new one (+ a new subdir)
    await writeFile(join(workspaceRoot, 'kept.txt'), 'modified\n')
    await rm(join(workspaceRoot, 'removed-by-turn.txt'))
    await writeFile(join(workspaceRoot, 'created-by-turn.txt'), 'model junk\n')
    await mkdir(join(workspaceRoot, 'newdir'))
    await writeFile(join(workspaceRoot, 'newdir', 'deep.txt'), 'junk\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    // modified file rolled back, deleted file re-created
    assert.equal(readFileSync(join(workspaceRoot, 'kept.txt'), 'utf8'), 'original\n')
    assert.equal(
      readFileSync(join(workspaceRoot, 'removed-by-turn.txt'), 'utf8'),
      'should come back\n',
    )
    // files created during the turn are removed (the bug: checkout alone left them)
    assert.equal(
      existsSync(join(workspaceRoot, 'created-by-turn.txt')),
      false,
      'a file created during the turn must be removed by the restore',
    )
    assert.equal(existsSync(join(workspaceRoot, 'newdir')), false)
    // affectedFiles now includes the added file (was previously under-reported)
    assert.ok(result.affectedFiles.includes('created-by-turn.txt'))
    assert.ok(result.affectedFiles.includes('kept.txt'))
    assert.ok(result.affectedFiles.includes('removed-by-turn.txt'))
  })
})

test('restoreSnapshot preserves .gitignored artifacts while removing tracked junk', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-ignore-'))
    await writeFile(join(workspaceRoot, '.gitignore'), 'build/\n')
    await writeFile(join(workspaceRoot, 'src.txt'), 'orig\n')
    await mkdir(join(workspaceRoot, 'build'))
    await writeFile(join(workspaceRoot, 'build', 'artifact.o'), 'pre-existing build output\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-ignore',
      phase: 'pre',
    })
    await writeFile(join(workspaceRoot, 'src.txt'), 'modified\n')
    await writeFile(join(workspaceRoot, 'junk.txt'), 'remove me\n')
    await writeFile(join(workspaceRoot, 'build', 'new-artifact.o'), 'new build output\n')

    await restoreSnapshot({ workspaceRoot, snapshotId: snapshot.commitSha })

    assert.equal(readFileSync(join(workspaceRoot, 'src.txt'), 'utf8'), 'orig\n')
    // non-ignored junk removed
    assert.equal(existsSync(join(workspaceRoot, 'junk.txt')), false)
    // ignored build artifacts preserved — clean -fd respects .gitignore so a revert
    // never nukes node_modules/build (symmetric with capture's `add -A`)
    assert.equal(existsSync(join(workspaceRoot, 'build', 'artifact.o')), true)
    assert.equal(existsSync(join(workspaceRoot, 'build', 'new-artifact.o')), true)
  })
})

test('restoreSnapshot resolves a file/directory conflict (turn replaced a dir with a file)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-conflict-'))
    await mkdir(join(workspaceRoot, 'dir'))
    await writeFile(join(workspaceRoot, 'dir', 'file.txt'), 'snapshot content\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-conflict',
      phase: 'pre',
    })
    // the turn replaces the directory `dir/` with a plain file named `dir`
    await rm(join(workspaceRoot, 'dir'), { recursive: true })
    await writeFile(join(workspaceRoot, 'dir'), 'now a file\n')

    // must not throw (clean removes the conflicting file before checkout-index)
    await restoreSnapshot({ workspaceRoot, snapshotId: snapshot.commitSha })

    assert.equal(statSync(join(workspaceRoot, 'dir')).isDirectory(), true)
    assert.equal(
      readFileSync(join(workspaceRoot, 'dir', 'file.txt'), 'utf8'),
      'snapshot content\n',
    )
  })
})

test('restoreSnapshot prunes against the snapshot .gitignore, not a broadened in-turn one', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-ignore-broaden-'))
    await writeFile(join(workspaceRoot, '.gitignore'), '*.log\n')
    await writeFile(join(workspaceRoot, 'app.js'), 'orig\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-ignore-broaden',
      phase: 'pre',
    })
    // the turn BROADENS .gitignore to also ignore build/, then creates build/junk.txt
    await writeFile(join(workspaceRoot, '.gitignore'), '*.log\nbuild/\n')
    await mkdir(join(workspaceRoot, 'build'))
    await writeFile(join(workspaceRoot, 'build', 'junk.txt'), 'junk\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    // the SNAPSHOT's .gitignore does not ignore build/, so the file (created after
    // the snapshot) must be removed — the prune runs after the snapshot .gitignore
    // is restored, not against the live broadened one.
    assert.equal(existsSync(join(workspaceRoot, 'build', 'junk.txt')), false)
    assert.equal(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8'), '*.log\n')
    assert.ok(result.affectedFiles.includes('build/junk.txt'))
  })
})

test('restoreSnapshot prunes files hidden by an untracked nested .gitignore the turn created', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-nested-ignore-'))
    await writeFile(join(workspaceRoot, '.gitignore'), '*.log\n')
    await writeFile(join(workspaceRoot, 'app.js'), 'orig\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-nested-ignore',
      phase: 'pre',
    })
    // The turn creates a brand-new build/ dir whose OWN untracked .gitignore hides
    // build/junk.txt. A single `clean -fd` would skip junk.txt (ignored by the live
    // nested .gitignore) and only remove the .gitignore, leaving junk.txt behind.
    await mkdir(join(workspaceRoot, 'build'))
    await writeFile(join(workspaceRoot, 'build', '.gitignore'), 'junk.txt\n')
    await writeFile(join(workspaceRoot, 'build', 'junk.txt'), 'junk\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    // The iterative prune strips the .gitignore first, un-hiding junk.txt next pass.
    assert.equal(existsSync(join(workspaceRoot, 'build', 'junk.txt')), false)
    assert.equal(existsSync(join(workspaceRoot, 'build')), false)
    assert.ok(result.affectedFiles.includes('build/.gitignore'))
    assert.ok(result.affectedFiles.includes('build/junk.txt'))
  })
})

test('restoreSnapshot converges on a deep chain of nested untracked .gitignore files', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-deep-ignore-'))
    await writeFile(join(workspaceRoot, 'keep.txt'), 'keep\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-deep-ignore',
      phase: 'pre',
    })
    // a/.gitignore hides the whole b/ subtree; a/b/.gitignore hides secret.txt.
    await mkdir(join(workspaceRoot, 'a', 'b'), { recursive: true })
    await writeFile(join(workspaceRoot, 'a', '.gitignore'), 'b/\n')
    await writeFile(join(workspaceRoot, 'a', 'b', '.gitignore'), 'secret.txt\n')
    await writeFile(join(workspaceRoot, 'a', 'b', 'secret.txt'), 'secret\n')
    await writeFile(join(workspaceRoot, 'a', 'b', 'visible.txt'), 'visible\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    assert.equal(existsSync(join(workspaceRoot, 'a')), false)
    assert.equal(existsSync(join(workspaceRoot, 'keep.txt')), true)
    for (const path of [
      'a/.gitignore',
      'a/b/.gitignore',
      'a/b/secret.txt',
      'a/b/visible.txt',
    ]) {
      assert.ok(result.affectedFiles.includes(path), `affectedFiles missing ${path}`)
    }
  })
})

test('restoreSnapshot prunes a self-hiding .gitignore chain deeper than any fixed pass cap', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-deepcap-'))
    await writeFile(join(workspaceRoot, 'keep.txt'), 'keep\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-deep-cap',
      phase: 'pre',
    })
    // Build a chain where each dir's .gitignore hides ONLY the next dir, so the
    // prune can peel just one layer per pass. A depth past any small fixed cap
    // (the loop has none — it terminates by monotonic shrink) proves the deepest
    // leaf is still removed and reported, not silently left behind.
    const depth = 70
    const segments = []
    for (let level = 1; level <= depth; level += 1) {
      segments.push(`d${level}`)
      await mkdir(join(workspaceRoot, ...segments), { recursive: true })
      const gitignoreBody = level < depth ? `d${level + 1}/\n` : 'secret.txt\n'
      await writeFile(join(workspaceRoot, ...segments, '.gitignore'), gitignoreBody)
    }
    await writeFile(join(workspaceRoot, ...segments, 'secret.txt'), 'secret\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    const secretPath = [...segments, 'secret.txt'].join('/')
    assert.equal(existsSync(join(workspaceRoot, 'd1')), false)
    assert.equal(existsSync(join(workspaceRoot, ...segments, 'secret.txt')), false)
    assert.equal(existsSync(join(workspaceRoot, 'keep.txt')), true)
    assert.ok(
      result.affectedFiles.includes(secretPath),
      `deepest leaf ${secretPath} missing from affectedFiles`,
    )
  })
})

test('restoreSnapshot reports non-ASCII affected filenames intact (not C-quoted)', async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-cjk-'))
    await writeFile(join(workspaceRoot, '配置.txt'), 'orig\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-cjk',
      phase: 'pre',
    })
    await writeFile(join(workspaceRoot, '配置.txt'), 'modified\n')
    await writeFile(join(workspaceRoot, '新建文件.txt'), 'created in turn\n')

    const result = await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    assert.equal(readFileSync(join(workspaceRoot, '配置.txt'), 'utf8'), 'orig\n')
    assert.equal(existsSync(join(workspaceRoot, '新建文件.txt')), false)
    // -z parsing keeps the raw UTF-8 names — no "\351\205\215\347\275\256" garbage
    assert.ok(result.affectedFiles.includes('配置.txt'))
    assert.ok(result.affectedFiles.includes('新建文件.txt'))
  })
})

test('revert_turn permission result warns that files created after the snapshot are removed', () => {
  const result = buildRevertTurnPermissionResult({ turn_id: 5 })
  assert.match(result.message, /remove/i)
  assert.match(result.decisionReason.reason, /removing files created after the snapshot/i)
})

test('performRestore requires confirmation before checkout', async () => {
  let called = false

  const result = await performRestore({
    workspaceRoot: '/tmp/deepcode-restore-confirm',
    snapshotId: 'a'.repeat(40),
    confirmed: false,
    restoreSnapshotFn: async () => {
      called = true
    },
  })

  assert.equal(called, false)
  assert.equal(result.kind, 'confirmation_required')
})

test('performRestore reports lock contention as snapshot store busy', async () => {
  const result = await performRestore({
    workspaceRoot: '/tmp/deepcode-restore-lock',
    snapshotId: 'a'.repeat(40),
    confirmed: true,
    restoreSnapshotFn: async () => {
      throw new Error('Timed out acquiring snapshot lock: /tmp/snapshot.lock')
    },
  })

  assert.equal(result.kind, 'busy')
  assert.equal(result.message, 'Snapshot store busy, try again')
})

test("restoreSnapshot leaves user's git metadata unchanged", async () => {
  await withDeepCodeHome(async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-restore-git-'))
    runGit(['init'], workspaceRoot)
    const filePath = join(workspaceRoot, 'tracked.txt')
    await writeFile(filePath, 'before\n')
    const snapshot = await createSnapshot({
      workspaceRoot,
      turnId: 'turn-git',
      phase: 'pre',
    })
    await writeFile(filePath, 'after\n')

    const headPath = join(workspaceRoot, '.git', 'HEAD')
    const headBefore = readFileSync(headPath, 'utf8')
    const headMtimeBefore = statSync(headPath).mtimeMs
    const userIndexPath = join(workspaceRoot, '.git', 'index')
    const hadUserIndex = existsSync(userIndexPath)

    await restoreSnapshot({
      workspaceRoot,
      snapshotId: snapshot.commitSha,
    })

    assert.equal(readFileSync(filePath, 'utf8'), 'before\n')
    assert.equal(readFileSync(headPath, 'utf8'), headBefore)
    assert.equal(statSync(headPath).mtimeMs, headMtimeBefore)
    assert.equal(existsSync(userIndexPath), hadUserIndex)
  })
})

test('revert_turn validates positive integer turn_id only', () => {
  assert.deepEqual(validateRevertTurnInput({ turn_id: 7 }), { turnId: 7 })
  assert.throws(
    () => validateRevertTurnInput({ turn_id: -1 }),
    /positive integer/,
  )
  assert.throws(
    () => validateRevertTurnInput({ turn_id: 1, snapshot_id: 'a'.repeat(40) }),
    /only accepts/,
  )
})

test('revert_turn resolves turn_id to the latest pre snapshot by default', async () => {
  const entry = await resolveRevertTurnSnapshot({
    workspaceRoot: '/tmp/deepcode-revert-turn',
    turnId: 3,
    listSnapshotsFn: async () => [
      { turnId: 3, phase: 'post', commitSha: 'post-sha' },
      { turnId: 'turn-3', phase: 'pre', commitSha: 'old-pre-sha' },
      { turnId: 3, phase: 'pre', commitSha: 'new-pre-sha' },
    ],
  })

  assert.equal(entry.commitSha, 'new-pre-sha')
})

test('revert_turn performs restore through snapshot service and formats result', async () => {
  const calls = []
  const result = await performRevertTurn({
    workspaceRoot: '/tmp/deepcode-revert-turn',
    input: { turn_id: 4 },
    listSnapshotsFn: async () => [
      {
        turnId: 4,
        phase: 'pre',
        commitSha: 'snapshot-sha',
      },
    ],
    restoreSnapshotFn: async args => {
      calls.push(args)
      return {
        snapshotId: args.snapshotId,
        affectedFileCount: 2,
        affectedFiles: ['a.txt', 'b.txt'],
      }
    },
  })

  assert.deepEqual(calls, [
    {
      workspaceRoot: '/tmp/deepcode-revert-turn',
      snapshotId: 'snapshot-sha',
    },
  ])
  assert.equal(result.turnId, 4)
  assert.equal(result.phase, 'pre')
  assert.equal(result.affectedFileCount, 2)
  assert.match(formatRevertTurnResult(result), /Reverted turn 4/)
  assert.match(formatRevertTurnResult(result), /2 affected files/)
})

test('revert_turn permission result requires explicit confirmation', () => {
  const result = buildRevertTurnPermissionResult({ turn_id: 5 })

  assert.equal(result.behavior, 'ask')
  assert.equal(result.decisionReason.type, 'safetyCheck')
  assert.equal(result.decisionReason.classifierApprovable, false)
})

test('revert_turn tool is registered and marked destructive', () => {
  const toolSource = readFileSync(
    new URL('../src/tools/RevertTurnTool/RevertTurnTool.ts', import.meta.url),
    'utf8',
  )
  const registrySource = readFileSync(
    new URL('../src/tools.ts', import.meta.url),
    'utf8',
  )

  assert.match(toolSource, /name:\s*'revert_turn'/)
  assert.match(toolSource, /isDestructive\([^)]*\)\s*\{\s*return true/)
  assert.match(registrySource, /RevertTurnTool/)
})

async function withDeepCodeHome(callback) {
  const previous = process.env.DEEPCODE_CONFIG_DIR
  const home = await mkdtemp(join(tmpdir(), 'deepcode-snapshot-home-'))
  process.env.DEEPCODE_CONFIG_DIR = home
  try {
    return await callback(home)
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPCODE_CONFIG_DIR
    } else {
      process.env.DEEPCODE_CONFIG_DIR = previous
    }
  }
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  })
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return result.stdout
}
