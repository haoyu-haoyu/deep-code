import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('buildSnapshotTurnId uses first message uuid with generation fallback', () => {
  assert.equal(
    buildSnapshotTurnId({
      generation: 7,
      messages: [{ uuid: 'message-uuid' }],
    }),
    'message-uuid',
  )
  assert.equal(buildSnapshotTurnId({ generation: 8, messages: [] }), 'turn-8')
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
