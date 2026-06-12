import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { resolveSnapshotStore } from './paths.mjs'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_STALE_MS = 60_000
const RETRY_DELAY_MS = 25
const queues = new Map()

export async function acquireLock({
  workspaceRoot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  staleMs = DEFAULT_STALE_MS,
}) {
  const store = resolveSnapshotStore({ workspaceRoot })
  const lockPath = join(store.storePath, 'snapshot.lock')
  const previous = queues.get(lockPath) ?? Promise.resolve()
  let releaseQueue
  const current = previous
    .catch(() => {})
    .then(
      () =>
        new Promise(resolve => {
          releaseQueue = resolve
        }),
    )
  queues.set(lockPath, current)
  await previous.catch(() => {})

  try {
    const handle = await acquireFileLock({ lockPath, timeoutMs, staleMs })
    return {
      ownerId: handle.ownerId,
      release: async () => {
        try {
          await handle.release()
        } finally {
          releaseQueue?.()
          if (queues.get(lockPath) === current) queues.delete(lockPath)
        }
      },
    }
  } catch (error) {
    releaseQueue?.()
    if (queues.get(lockPath) === current) queues.delete(lockPath)
    throw error
  }
}

async function acquireFileLock({ lockPath, timeoutMs, staleMs }) {
  await mkdir(dirname(lockPath), { recursive: true })
  const startedAt = Date.now()
  const metadata = {
    ownerId: randomUUID(),
    pid: process.pid,
    ts: Date.now(),
    hostname: hostname(),
  }

  while (true) {
    try {
      const file = await open(lockPath, 'wx')
      try {
        await file.writeFile(JSON.stringify(metadata))
      } finally {
        await file.close()
      }
      // Keep the held lock visibly alive: refresh ts well inside the TTL so
      // the TTL-based recovery below never steals a lock whose holder is
      // merely slow (a large `git add -A` can outlive any fixed TTL). The
      // ownership check stops the refresher if the lock was ever taken over
      // (e.g. this process slept past the TTL), so a stolen lock is never
      // clobbered back. unref'd: a refresher must not pin the event loop.
      const refresher = setInterval(() => {
        void refreshLockTimestamp(lockPath, metadata, refresher)
      }, Math.max(1, Math.floor(staleMs / 3)))
      refresher.unref?.()
      return {
        ownerId: metadata.ownerId,
        release: () => {
          clearInterval(refresher)
          return releaseFileLock(lockPath, metadata.ownerId)
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (await recoverStaleLock(lockPath, staleMs)) continue
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out acquiring snapshot lock: ${lockPath}`)
      }
      await delay(RETRY_DELAY_MS)
    }
  }
}

async function refreshLockTimestamp(lockPath, metadata, refresher) {
  try {
    const current = await readLockMetadata(lockPath)
    if (current?.ownerId !== metadata.ownerId) {
      clearInterval(refresher)
      return
    }
    await writeFile(lockPath, JSON.stringify({ ...metadata, ts: Date.now() }))
  } catch {
    // best-effort: a failed refresh leaves the previous ts; the holder only
    // becomes stealable if refreshes keep failing past the TTL
  }
}

async function recoverStaleLock(lockPath, staleMs) {
  if (!existsSync(lockPath)) return false
  const metadata = await readLockMetadata(lockPath)
  if (!metadata) return false
  if (Date.now() - metadata.ts >= staleMs) {
    // The TTL is authoritative: live holders refresh ts (above), so an
    // over-age lock is a crashed or wedged holder even when its recorded pid
    // is ALIVE — pids get recycled after a crash or reboot (often to a
    // system daemon where the kill-0 probe returns EPERM = "alive"), and the
    // old pid-AND-TTL rule turned that into a permanent stall on every
    // acquisition until someone hand-deleted the lock.
    await rm(lockPath, { force: true })
    return true
  }
  // Fast path: a dead pid recorded by THIS host needn't wait out the TTL.
  // Foreign hosts' pids are meaningless locally (the file may live on a
  // network volume), so the probe is hostname-gated.
  if (metadata.hostname === hostname() && !isPidAlive(metadata.pid)) {
    await rm(lockPath, { force: true })
    return true
  }
  return false
}

async function releaseFileLock(lockPath, ownerId) {
  if (!existsSync(lockPath)) return
  const metadata = await readLockMetadata(lockPath)
  if (metadata?.ownerId !== ownerId) {
    throw new Error('Lock ownership changed; refusing to release')
  }
  await unlink(lockPath)
}

async function readLockMetadata(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'))
  } catch {
    return null
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
