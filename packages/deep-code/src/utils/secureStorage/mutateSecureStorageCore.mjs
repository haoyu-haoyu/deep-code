// Synchronous locked read-modify-write of the whole secure-storage blob.
//
// The credentials blob is written as a unit, so two processes that each
// read → rebuild → write can lose one another's changes (e.g. two MCP servers
// refreshing tokens at once: the second write restores the first server's OLD
// refresh token, which its AS already rotated → spurious re-auth). Serializing
// the RMW behind a cross-process lock AND re-reading the blob INSIDE the lock
// (so the merge starts from the freshest on-disk state) closes the race.
//
// Pure orchestration with injected deps so it is node-testable. The wrapper
// (mutateSecureStorage.ts) supplies the real lockfile, storage, and keychain
// cache. We NEVER pass `retries` to lockSync — the vendored `retry` package is
// a stub that makes proper-lockfile hang on first contention — and instead own
// a small bounded backoff, proceeding lock-free after `attempts` (a degraded
// last-writer-wins is better than wedging a token write forever).

const MAX_BACKOFF_MS = 200

function sleepViaAtomics(ms) {
  // Block the calling thread without a busy-loop; legal on the main thread and
  // costs ~no CPU. Holds here are a single file read+write, i.e. sub-millisecond.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * @param {{
 *   lockSync: (path: string, opts: object) => () => void,
 *   lockPath: string,
 *   read: () => any,
 *   update: (blob: any) => any,
 *   ensureDir?: () => void,
 *   clearCache?: () => void,
 *   sleep?: (ms: number) => void,
 *   attempts?: number,
 *   backoffMs?: number,
 *   log?: (msg: string) => void,
 *   onCompromised?: (err: unknown) => void,
 * }} deps
 * @param {(blob: any) => any} updater receives the freshly-read blob, returns the new blob
 * @returns {any} whatever `update` returns
 */
export function runMutateSecureStorage(deps, updater) {
  const {
    lockSync,
    lockPath,
    read,
    update,
    ensureDir = () => {},
    clearCache = () => {},
    sleep = sleepViaAtomics,
    attempts = 5,
    backoffMs = 25,
    log = () => {},
    onCompromised = () => {},
  } = deps

  // The lock file lives beside the credentials file; create the dir first so the
  // very first write isn't silently unlocked on an ENOENT.
  try {
    ensureDir()
  } catch {
    // best effort — update() recreates the dir too
  }

  let release
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      release = lockSync(lockPath, { realpath: false, onCompromised })
      break
    } catch (e) {
      const code = e && e.code
      if (code === 'ELOCKED') {
        sleep(Math.min(backoffMs * (attempt + 1), MAX_BACKOFF_MS))
        continue
      }
      // Any other lock error (e.g. unresolvable vendored dep, EPERM): don't
      // wedge a credential write — proceed without the lock.
      log(`secure-storage lock failed (${code}); proceeding without lock`)
      break
    }
  }
  if (!release) {
    log(`secure-storage lock not acquired after ${attempts} attempts; proceeding without lock`)
  }

  try {
    // Re-read INSIDE the lock so the merge starts from the freshest blob.
    clearCache()
    const current = read() || {}
    const next = updater(current)
    return update(next)
  } finally {
    if (release) {
      try {
        release()
      } catch {
        // releasing a compromised/already-released lock is non-fatal
      }
    }
  }
}
