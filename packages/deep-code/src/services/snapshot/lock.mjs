import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
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
      return {
        ownerId: metadata.ownerId,
        release: () => releaseFileLock(lockPath, metadata.ownerId),
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

async function recoverStaleLock(lockPath, staleMs) {
  if (!existsSync(lockPath)) return false
  const metadata = await readLockMetadata(lockPath)
  if (!metadata) return false
  if (Date.now() - metadata.ts < staleMs) return false
  if (isPidAlive(metadata.pid)) return false
  await unlink(lockPath)
  return true
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
