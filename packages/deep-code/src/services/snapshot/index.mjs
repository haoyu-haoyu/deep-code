import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { appendManifest, readManifest } from './manifest.mjs'
import { initializeSideGit, runSideGit } from './storeInit.mjs'

export const SNAPSHOT_HASH_VERSION = 1

export function computeWorkspaceHash(workspaceRoot) {
  return createHash('sha256')
    .update(normalizeWorkspaceRoot(workspaceRoot))
    .digest('hex')
    .slice(0, 16)
}

export function resolveSnapshotStore({ workspaceRoot }) {
  const workspaceHash = computeWorkspaceHash(workspaceRoot)
  const storePath = join(resolveDeepCodeHome(), 'snapshots', workspaceHash)
  return {
    storePath,
    gitDir: join(storePath, '.git'),
    manifestPath: join(storePath, 'manifest.json'),
    workspaceHash,
  }
}

export async function createSnapshot({ workspaceRoot, turnId, phase }) {
  validateSnapshotPhase(phase)
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  const store = resolveSnapshotStore({ workspaceRoot: normalizedWorkspaceRoot })

  await initializeSideGit(store.gitDir, normalizedWorkspaceRoot)
  await runSideGit(store.gitDir, normalizedWorkspaceRoot, ['add', '-A', '--', '.'])
  await runSideGit(store.gitDir, normalizedWorkspaceRoot, [
    'commit',
    '--allow-empty',
    '-m',
    `turn-${String(turnId)}-${phase}`,
  ])
  const commitSha = (
    await runSideGit(store.gitDir, normalizedWorkspaceRoot, ['rev-parse', 'HEAD'])
  ).trim()
  const changedFiles = await listCommitFiles(
    store.gitDir,
    normalizedWorkspaceRoot,
    commitSha,
  )

  const entry = {
    turnId,
    phase,
    timestamp: Date.now(),
    commitSha,
    workspaceRoot: normalizedWorkspaceRoot,
    hashVersion: SNAPSHOT_HASH_VERSION,
    changedFiles,
  }
  await appendManifest(store.manifestPath, entry)
  return entry
}

export async function listSnapshots({ workspaceRoot, limit = 10 }) {
  const store = resolveSnapshotStore({ workspaceRoot })
  const entries = await readManifest(store.manifestPath)
  const normalizedLimit = Math.max(0, Number(limit) || 0)
  if (normalizedLimit === 0) return []
  return entries.slice(-normalizedLimit)
}

function resolveDeepCodeHome() {
  return (
    process.env.DEEPCODE_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.deepcode')
  )
}

function normalizeWorkspaceRoot(workspaceRoot) {
  const resolved = resolve(workspaceRoot).normalize('NFC')
  try {
    return realpathSync.native(resolved).normalize('NFC')
  } catch {
    return resolved
  }
}

function validateSnapshotPhase(phase) {
  if (!['pre', 'post', 'aborted'].includes(phase)) {
    throw new Error(`Invalid snapshot phase: ${phase}`)
  }
}

async function listCommitFiles(gitDir, workTree, commitSha) {
  const raw = await runSideGit(gitDir, workTree, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '--root',
    commitSha,
  ])
  return raw
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
}
