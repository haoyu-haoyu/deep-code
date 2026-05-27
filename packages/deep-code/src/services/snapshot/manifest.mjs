import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return []
  const raw = await readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(`Snapshot manifest must be an array: ${manifestPath}`)
  }
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
