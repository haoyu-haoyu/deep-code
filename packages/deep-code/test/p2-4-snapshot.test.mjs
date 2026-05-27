import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  checkAndPrune,
  getSnapshotStoreSize,
} from '../src/services/snapshot/diskCap.mjs'
import { acquireLock } from '../src/services/snapshot/lock.mjs'
import {
  appendManifest,
  readManifest,
} from '../src/services/snapshot/manifest.mjs'
import {
  computeWorkspaceHash,
  createSnapshot,
  listSnapshots,
  resolveSnapshotStore,
} from '../src/services/snapshot/index.mjs'

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
