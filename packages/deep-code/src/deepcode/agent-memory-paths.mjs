import { join, normalize, sep } from 'node:path'
import {
  DEEPCODE_PROJECT_DIR,
  LEGACY_CLAUDE_PROJECT_DIR,
} from './instruction-paths.mjs'

export const AGENT_MEMORY_DIR = 'agent-memory'
export const AGENT_MEMORY_LOCAL_DIR = 'agent-memory-local'
export const AGENT_MEMORY_SNAPSHOT_DIR = 'agent-memory-snapshots'

export function sanitizeAgentTypeForMemoryPath(agentType) {
  return agentType.replace(/:/g, '-')
}

export function getPreferredAgentMemoryDir({
  agentType,
  scope,
  cwd,
  memoryBaseDir,
  legacyMemoryBaseDir,
  remoteLocalDir,
  exists = () => false,
}) {
  const dirName = sanitizeAgentTypeForMemoryPath(agentType)
  if (scope === 'user') {
    return withTrailingSeparator(
      preferExistingPath(
        join(memoryBaseDir, AGENT_MEMORY_DIR, dirName),
        legacyMemoryBaseDir
          ? join(legacyMemoryBaseDir, AGENT_MEMORY_DIR, dirName)
          : undefined,
        exists,
      ),
    )
  }

  if (scope === 'local' && remoteLocalDir) {
    return withTrailingSeparator(remoteLocalDir)
  }

  const dir =
    scope === 'local' ? AGENT_MEMORY_LOCAL_DIR : AGENT_MEMORY_DIR
  return withTrailingSeparator(
    preferExistingPath(
      join(cwd, DEEPCODE_PROJECT_DIR, dir, dirName),
      join(cwd, LEGACY_CLAUDE_PROJECT_DIR, dir, dirName),
      exists,
    ),
  )
}

export function getPreferredAgentMemorySnapshotDir({
  agentType,
  cwd,
  exists = () => false,
}) {
  const dirName = sanitizeAgentTypeForMemoryPath(agentType)
  return preferExistingPath(
    join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR, dirName),
    join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR, dirName),
    exists,
  )
}

export function isDeepCodeAgentMemoryPath({
  absolutePath,
  cwd,
  memoryBaseDir,
  legacyMemoryBaseDir,
  remoteMemoryDir,
}) {
  const normalizedPath = normalize(absolutePath)
  const candidates = [
    join(memoryBaseDir, AGENT_MEMORY_DIR),
    legacyMemoryBaseDir
      ? join(legacyMemoryBaseDir, AGENT_MEMORY_DIR)
      : undefined,
    join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_DIR),
    join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_DIR),
    join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_LOCAL_DIR),
    join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_LOCAL_DIR),
    join(cwd, DEEPCODE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR),
    join(cwd, LEGACY_CLAUDE_PROJECT_DIR, AGENT_MEMORY_SNAPSHOT_DIR),
    remoteMemoryDir ? join(remoteMemoryDir, 'projects') : undefined,
  ].filter(Boolean)

  return candidates.some(candidate =>
    normalizedPath.startsWith(withTrailingSeparator(candidate)),
  )
}

function preferExistingPath(primary, legacy, exists) {
  if (exists(primary)) {
    return primary
  }
  if (legacy && exists(legacy)) {
    return legacy
  }
  return primary
}

function withTrailingSeparator(path) {
  return path.endsWith(sep) ? path : path + sep
}
