import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
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
      // refresher (a) writes via tmp+rename so a crash mid-refresh can never
      // leave the lock file unparseable (an unreadable lock would otherwise
      // be unrecoverable), (b) FORFEITS — stops writing forever — once its
      // own liveness gap exceeds the TTL (a holder that slept past the TTL
      // may have been legitimately stolen and must not clobber the thief),
      // and (c) re-checks ownership before each write. unref'd: it must not
      // pin the event loop.
      const holder = {
        lockPath,
        metadata,
        staleMs,
        lastLiveAt: Date.now(),
        releasing: false,
        inflight: Promise.resolve(),
        refresher: null,
      }
      holder.refresher = setInterval(() => {
        // Chain, never overlap: a tick stalled in slow I/O must finish before
        // the next starts, and release() awaiting the chain TAIL therefore
        // awaits every outstanding tick — not just the most recent one.
        // (refreshLockTimestamp never rejects, so the chain cannot break.)
        holder.inflight = holder.inflight.then(() =>
          refreshLockTimestamp(holder),
        )
      }, Math.max(1, Math.floor(staleMs / 3)))
      holder.refresher.unref?.()
      return {
        ownerId: metadata.ownerId,
        release: async () => {
          // Stop the refresher AND wait out any in-flight tick: clearInterval
          // does not cancel an already-running refresh, whose pending write
          // could otherwise recreate the lock file after the unlink below.
          holder.releasing = true
          clearInterval(holder.refresher)
          await holder.inflight.catch(() => {})
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

async function refreshLockTimestamp(holder) {
  try {
    // Forfeit: if our own liveness gap reached the TTL (event loop wedged,
    // process slept), a contender may have legitimately recovered the lock —
    // a forfeit holder must never write again, even if the file still (or
    // again) carries our ownerId.
    if (Date.now() - holder.lastLiveAt >= holder.staleMs) {
      clearInterval(holder.refresher)
      return
    }
    const current = await readLockMetadata(holder.lockPath)
    if (current?.ownerId !== holder.metadata.ownerId) {
      clearInterval(holder.refresher)
      return
    }
    if (holder.releasing) return
    // tmp+rename: the lock file is replaced atomically, so a crash mid-refresh
    // leaves the previous (parseable) content, never a truncated half-write
    // that recoverStaleLock could only escape via the mtime fallback.
    const tmpPath = `${holder.lockPath}.refresh.tmp`
    await writeFile(
      tmpPath,
      JSON.stringify({ ...holder.metadata, ts: Date.now() }),
    )
    if (holder.releasing) {
      await rm(tmpPath, { force: true })
      return
    }
    // Final liveness gate, re-evaluated at the last instant before the rename
    // publishes: the process may have been PAUSED since the ownership re-read
    // above (SIGSTOP, VM freeze) — long enough for a contender to age this
    // holder out and take the lock. If our own gap reached the TTL, forfeit
    // instead of clobbering the thief; the unavoidable residue is a pause
    // landing entirely between this check and the rename syscall.
    if (Date.now() - holder.lastLiveAt >= holder.staleMs) {
      clearInterval(holder.refresher)
      await rm(tmpPath, { force: true })
      return
    }
    await rename(tmpPath, holder.lockPath)
    holder.lastLiveAt = Date.now()
  } catch {
    // best-effort: a failed refresh leaves the previous ts; the holder only
    // becomes stealable if refreshes keep failing past the TTL
  }
}

async function recoverStaleLock(lockPath, staleMs) {
  // Cheap peek first: avoid claiming the reaper at every retry tick while a
  // perfectly healthy lock exists. An ABSENT lock means someone already
  // recovered it — nothing to delete, the caller just retries open('wx').
  const peek = await classifyLock(lockPath, staleMs)
  if (peek === 'fresh') return false
  if (peek === 'absent') return true

  // The deletion must be an ATOMIC CLAIM, not read-then-rm: two contenders
  // that both observed the stale lock would otherwise both proceed, and the
  // loser's rm — already decided on the OLD observation — would delete the
  // winner's freshly-acquired lock (empirically a ~15% mutual-exclusion
  // violation under contended recovery). Exactly one recoverer wins the
  // reaper sidecar via open('wx'), RE-VERIFIES staleness inside the critical
  // section, and only then removes the lock; a fresh lock acquired in the
  // meantime fails the re-verify and survives. The claim carries its own
  // ownerId so a recoverer paused past the TTL (its claim mtime-reclaimed by
  // another) detects the takeover and aborts instead of deleting a lock that
  // is no longer the one it verified.
  const reaperPath = `${lockPath}.reaper`
  const claim = { ownerId: randomUUID(), claimedAt: Date.now() }
  let reaper
  try {
    reaper = await open(reaperPath, 'wx')
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    // Another recoverer holds the claim (milliseconds), or a crashed one
    // orphaned it: reclaim the ORPHAN once its mtime is a full TTL old, then
    // let the caller's retry loop come back around.
    try {
      const { mtimeMs } = await stat(reaperPath)
      if (Date.now() - mtimeMs >= staleMs) {
        await rm(reaperPath, { force: true })
      }
    } catch {
      // raced away — the caller retries
    }
    return false
  }
  try {
    try {
      await reaper.writeFile(JSON.stringify(claim))
    } finally {
      await reaper.close()
    }
    const verdict = await classifyLock(lockPath, staleMs)
    if (verdict === 'fresh') return false
    // 'absent': already recovered — return true WITHOUT the rm below, which
    // could otherwise delete a fresh lock recreated between this check and
    // the rm (open('wx') is not blocked by the reaper).
    if (verdict === 'absent') return true
    // Last-instant claim validity: if this process was paused long enough
    // for its claim to be mtime-reclaimed, the reaper — and possibly the
    // lock — now belongs to someone else. Abort without deleting anything;
    // the residue is a >TTL pause landing entirely between this gate and
    // the rm syscall.
    if (!(await claimIsOurs(reaperPath, claim, staleMs))) return false
    await rm(lockPath, { force: true })
    return true
  } finally {
    // Remove the reaper only while it is still OURS — a reclaimed claim
    // belongs to the next recoverer now (an orphan we leave behind is
    // mtime-reclaimed the same way).
    if (await claimIsOurs(reaperPath, claim, staleMs).catch(() => false)) {
      await rm(reaperPath, { force: true }).catch(() => {})
    }
  }
}

async function claimIsOurs(reaperPath, claim, staleMs) {
  // Floor the claim's validity window: with a degenerate tiny staleMs (tests
  // use 0 to make every lock instantly stale) the claim would otherwise be
  // dead on arrival and recovery could never complete. Reapers are held for
  // milliseconds, so one second is comfortably past any healthy reap while
  // still catching the real target — a recoverer paused long enough for its
  // claim to be mtime-reclaimed.
  if (Date.now() - claim.claimedAt >= Math.max(staleMs, 1_000)) return false
  try {
    const current = JSON.parse(await readFile(reaperPath, 'utf8'))
    return current?.ownerId === claim.ownerId
  } catch {
    return false
  }
}

async function classifyLock(lockPath, staleMs) {
  if (!existsSync(lockPath)) return 'absent'
  const metadata = await readLockMetadata(lockPath)
  if (!metadata) {
    // Unreadable lock (a crash between the open('wx') and the initial
    // metadata write, or hand-tampering). Its contents will never heal, so
    // recover once the FILE has stopped changing for a full TTL — a lock
    // mid-creation has a fresh mtime and is left alone.
    try {
      const { mtimeMs } = await stat(lockPath)
      return Date.now() - mtimeMs >= staleMs ? 'stale' : 'fresh'
    } catch {
      // raced away — already recovered
      return existsSync(lockPath) ? 'fresh' : 'absent'
    }
  }
  if (Date.now() - metadata.ts >= staleMs) {
    // The TTL is authoritative: live holders refresh ts (above), so an
    // over-age lock is a crashed or wedged holder even when its recorded pid
    // is ALIVE — pids get recycled after a crash or reboot (often to a
    // system daemon where the kill-0 probe returns EPERM = "alive"), and the
    // old pid-AND-TTL rule turned that into a permanent stall on every
    // acquisition until someone hand-deleted the lock.
    return 'stale'
  }
  // Fast path: a dead pid recorded by THIS host needn't wait out the TTL.
  // Foreign hosts' pids are meaningless locally (the file may live on a
  // network volume), so the probe is hostname-gated.
  return metadata.hostname === hostname() && !isPidAlive(metadata.pid)
    ? 'stale'
    : 'fresh'
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
