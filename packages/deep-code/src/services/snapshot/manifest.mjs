import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return []
  const raw = await readFile(manifestPath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A truncated/garbled manifest (crash mid-write on a legacy non-atomic
    // store, disk-full, external tampering, a 0-byte file) must not wedge the
    // whole snapshot subsystem: createSnapshot reads the manifest before it
    // appends, so a throw here would kill every future snapshot, /restore and
    // revert_turn until the user manually deletes the file. Degrade like the
    // sibling readLockMetadata and return []. We deliberately do NOT rename the
    // bad file aside here: readManifest runs from unlocked readers too
    // (listSnapshots), so a stale reader that observed the old corrupt bytes
    // could rename away a fresh, valid manifest a concurrent locked
    // createSnapshot just wrote, silently dropping history. Returning [] is
    // enough — the next appendManifest's atomic tmp+rename overwrites the
    // corrupt file and self-heals the store.
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
}

export async function appendManifest(manifestPath, entry) {
  const entries = await readManifest(manifestPath)
  const nextEntries = [...entries, entry]
  await writeManifestAtomically(manifestPath, nextEntries)
  return nextEntries
}

async function writeManifestAtomically(manifestPath, entries) {
  await mkdir(dirname(manifestPath), { recursive: true })
  const tmpPath = `${manifestPath}.${randomUUID()}.tmp`
  try {
    await writeFile(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(tmpPath, manifestPath)
  } catch (error) {
    try {
      await unlink(tmpPath)
    } catch {}
    throw error
  }
}
