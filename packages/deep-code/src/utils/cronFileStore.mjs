import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

// Lazy accessor for proper-lockfile, mirroring src/utils/lockfile.ts: the
// package monkey-patches every fs method on first require (~8ms via graceful-fs),
// so it must not be pulled into the startup path. Loaded only on the first lock.
let _lockfile
function getLockfile() {
  if (!_lockfile) {
    const require = createRequire(import.meta.url)
    _lockfile = require('proper-lockfile')
  }
  return _lockfile
}

// In-process serialization per file path. proper-lockfile is a CROSS-process
// primitive: concurrent SAME-process acquisitions of one file deadlock (each
// waiter retries against a lock its own process holds, and none can win). But
// in-process contention is real here — the scheduler tick's markCronTasksFired
// can race a user's addCronTask. So we gate same-process callers through a
// promise chain first (only one reaches proper-lockfile at a time), then take
// the cross-process file lock for other sessions. Same pattern as the DeepSeek
// cache-stats writer.
const inProcessQueues = new Map()

/**
 * Run `fn` while holding an exclusive lock on `filePath`, so a read-modify-write
 * of the cron file cannot interleave with another writer's RMW and lose an
 * update. The three cron mutators (add / remove / mark-fired) each do
 * read -> mutate -> write on the shared .claude/scheduled_tasks.json; without
 * this, concurrent writers race (a newly-created task vanishes, or a recurring
 * task's lastFiredAt stamp is clobbered and the task double-fires on reload).
 *
 * @param {string} filePath - the cron file path to guard (the lock resource)
 * @param {() => Promise<T>} fn - the read-modify-write to run under the lock
 * @param {{ lockImpl?: { lock: Function } }} [deps] - injectable lock for tests
 * @returns {Promise<T>} whatever `fn` resolves to
 * @template T
 */
export async function withCronFileLock(filePath, fn, deps = {}) {
  const run = (inProcessQueues.get(filePath) ?? Promise.resolve())
    .catch(() => {})
    .then(() => withCrossProcessLock(filePath, fn, deps))
  inProcessQueues.set(filePath, run)
  try {
    return await run
  } finally {
    // Drop the entry once this call is the queue tail so the Map does not grow
    // unbounded across many distinct paths.
    if (inProcessQueues.get(filePath) === run) {
      inProcessQueues.delete(filePath)
    }
  }
}

// Uses `realpath: false` so the lock targets the lexical path (always computed
// the same way) and does NOT require the data file to exist — only the lock
// sentinel `<filePath>.lock` is created, so a no-op mutator never leaves an
// empty scheduled_tasks.json behind. The parent dir must exist for the
// sentinel, so it is created first. `stale` lets a lock orphaned by a crashed
// process be broken; the retry budget rides out normal cross-process contention.
async function withCrossProcessLock(filePath, fn, { lockImpl } = {}) {
  const lockfile = lockImpl ?? getLockfile()
  await mkdir(dirname(filePath), { recursive: true })
  const release = await lockfile.lock(filePath, {
    realpath: false,
    stale: 10000,
    retries: { retries: 10, minTimeout: 25, maxTimeout: 200 },
  })
  try {
    return await fn()
  } finally {
    await release()
  }
}
