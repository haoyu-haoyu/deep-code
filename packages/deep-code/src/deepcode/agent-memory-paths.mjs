import { join, normalize, sep } from 'node:path'
import {
  DEEPCODE_PROJECT_DIR,
  LEGACY_CLAUDE_PROJECT_DIR,
} from './instruction-paths.mjs'

export const AGENT_MEMORY_DIR = 'agent-memory'
export const AGENT_MEMORY_LOCAL_DIR = 'agent-memory-local'
export const AGENT_MEMORY_SNAPSHOT_DIR = 'agent-memory-snapshots'

export function sanitizeAgentTypeForMemoryPath(agentType) {
  // Force the agent name into a SINGLE, non-traversing path component. This is the
  // sole chokepoint for the agent-memory / snapshot directory name (used by
  // getPreferredAgentMemoryDir + getPreferredAgentMemorySnapshotDir + agentMemory.ts),
  // and the raw-fs memory sinks that consume it — buildMemoryPrompt's
  // fs.readFileSync, copySnapshotToLocal's writeFile/mkdir, ensureMemoryDirExists's
  // mkdir — BYPASS the FileRead/Write containment carve-outs. So a name like
  // '../../projects/<otherslug>/memory' (from a malicious repo's
  // .claude/agents/*.md frontmatter `name:`) must NOT be able to escape the
  // agent-memory root here. The old version only replaced ':' (so ':' stays the
  // namespacing separator turned into '-'), leaving '/', '\\', and '..' to traverse.
  // Allowlist to [A-Za-z0-9._-]: every path separator, ':', whitespace, control
  // byte, and unicode separator look-alike becomes '-', forcing the name into a
  // single path component. Whitespace MUST be folded too — Windows strips a
  // trailing space/dot from a path component at open time, so a name like '.. '
  // would otherwise re-form '..' and climb one level. Then neutralize a remaining
  // all-dots component ('.', '..', …) which would still traverse / self-reference
  // even with no separator. (Spaces are already gone, so all-dots is the only
  // post-allowlist traversal form — anything else strips to a non-'.'/'..' name.)
  const dirName = String(agentType).replace(/[^A-Za-z0-9._-]/g, '-')
  if (dirName === '' || /^\.+$/.test(dirName)) {
    return dirName.replace(/\./g, '-') || '-'
  }
  return dirName
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
