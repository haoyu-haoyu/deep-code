import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const SNAPSHOT_HASH_VERSION = 1

export function computeWorkspaceHash(workspaceRoot) {
  return createHash('sha256')
    .update(normalizeWorkspaceRoot(workspaceRoot))
    .digest('hex')
    .slice(0, 16)
}

// Base directory holding every per-workspace snapshot store
// (~/.deepcode/snapshots/<hash>). Exposed so the background cleanup can sweep
// abandoned stores without re-deriving the path.
export function resolveSnapshotsBaseDir() {
  return join(resolveDeepCodeHome(), 'snapshots')
}

export function resolveSnapshotStore({ workspaceRoot }) {
  const workspaceHash = computeWorkspaceHash(workspaceRoot)
  const storePath = join(resolveSnapshotsBaseDir(), workspaceHash)
  return {
    storePath,
    gitDir: join(storePath, '.git'),
    manifestPath: join(storePath, 'manifest.json'),
    workspaceHash,
  }
}

export function normalizeWorkspaceRoot(workspaceRoot) {
  const resolved = resolve(workspaceRoot).normalize('NFC')
  try {
    return realpathSync.native(resolved).normalize('NFC')
  } catch {
    return resolved
  }
}

function resolveDeepCodeHome() {
  return (
    process.env.DEEPCODE_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.deepcode')
  )
}
