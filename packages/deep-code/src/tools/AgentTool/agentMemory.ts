import { existsSync } from 'fs'
import { join } from 'path'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  getPreferredAgentMemoryDir,
  isDeepCodeAgentMemoryPath,
  sanitizeAgentTypeForMemoryPath,
} from '../../deepcode/agent-memory-paths.mjs'
import {
  buildMemoryPrompt,
  ensureMemoryDirExists,
} from '../../memdir/memdir.js'
import { getMemoryBaseDir } from '../../memdir/paths.js'
import { getCwd } from '../../utils/cwd.js'
import { getLegacyClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { sanitizePath } from '../../utils/path.js'

// Persistent agent memory scope: 'user' (~/.deepcode/agent-memory/), 'project' (.deepcode/agent-memory/), or 'local' (.deepcode/agent-memory-local/)
export type AgentMemoryScope = 'user' | 'project' | 'local'

/**
 * Returns the local agent memory directory, which is project-specific and not checked into VCS.
 * When CLAUDE_CODE_REMOTE_MEMORY_DIR is set, persists to the mount with project namespacing.
 * Otherwise, uses <cwd>/.deepcode/agent-memory-local/<agentType>/.
 */
function getLocalAgentMemoryDir(agentType: string): string {
  const dirName = sanitizeAgentTypeForMemoryPath(agentType)
  if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
    return getPreferredAgentMemoryDir({
      agentType,
      scope: 'local',
      cwd: getCwd(),
      memoryBaseDir: getMemoryBaseDir(),
      legacyMemoryBaseDir: getLegacyClaudeConfigHomeDir(),
      remoteLocalDir: join(
        process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
        'projects',
        sanitizePath(
          findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot(),
        ),
        'agent-memory-local',
        dirName,
      ),
      exists: existsSync,
    })
  }
  return getPreferredAgentMemoryDir({
    agentType,
    scope: 'local',
    cwd: getCwd(),
    memoryBaseDir: getMemoryBaseDir(),
    legacyMemoryBaseDir: getLegacyClaudeConfigHomeDir(),
    exists: existsSync,
  })
}

/**
 * Returns the agent memory directory for a given agent type and scope.
 * - 'user' scope: <memoryBase>/agent-memory/<agentType>/
 * - 'project' scope: <cwd>/.deepcode/agent-memory/<agentType>/
 * - 'local' scope: see getLocalAgentMemoryDir()
 */
export function getAgentMemoryDir(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  switch (scope) {
    case 'project':
      return getPreferredAgentMemoryDir({
        agentType,
        scope,
        cwd: getCwd(),
        memoryBaseDir: getMemoryBaseDir(),
        legacyMemoryBaseDir: getLegacyClaudeConfigHomeDir(),
        exists: existsSync,
      })
    case 'local':
      return getLocalAgentMemoryDir(agentType)
    case 'user':
      return getPreferredAgentMemoryDir({
        agentType,
        scope,
        cwd: getCwd(),
        memoryBaseDir: getMemoryBaseDir(),
        legacyMemoryBaseDir: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
          ? undefined
          : getLegacyClaudeConfigHomeDir(),
        exists: existsSync,
      })
  }
}

// Check if file is within an agent memory directory (any scope).
export function isAgentMemoryPath(absolutePath: string): boolean {
  return isDeepCodeAgentMemoryPath({
    absolutePath,
    cwd: getCwd(),
    memoryBaseDir: getMemoryBaseDir(),
    legacyMemoryBaseDir: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
      ? undefined
      : getLegacyClaudeConfigHomeDir(),
    remoteMemoryDir: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
  })
}

/**
 * Returns the agent memory file path for a given agent type and scope.
 */
export function getAgentMemoryEntrypoint(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  return join(getAgentMemoryDir(agentType, scope), 'MEMORY.md')
}

export function getMemoryScopeDisplay(
  memory: AgentMemoryScope | undefined,
): string {
  switch (memory) {
    case 'user':
      return `User (${join(getMemoryBaseDir(), 'agent-memory')}/)`
    case 'project':
      return 'Project (.deepcode/agent-memory/)'
    case 'local':
      return `Local (${getLocalAgentMemoryDir('...')})`
    default:
      return 'None'
  }
}

/**
 * Load persistent memory for an agent with memory enabled.
 * Creates the memory directory if needed and returns a prompt with memory contents.
 *
 * @param agentType The agent's type name (used as directory name)
 * @param scope 'user' for ~/.deepcode/agent-memory/ or 'project' for .deepcode/agent-memory/
 */
export function loadAgentMemoryPrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  let scopeNote: string
  switch (scope) {
    case 'user':
      scopeNote =
        '- Since this memory is user-scope, keep learnings general since they apply across all projects'
      break
    case 'project':
      scopeNote =
        '- Since this memory is project-scope and shared with your team via version control, tailor your memories to this project'
      break
    case 'local':
      scopeNote =
        '- Since this memory is local-scope (not checked into version control), tailor your memories to this project and machine'
      break
  }

  const memoryDir = getAgentMemoryDir(agentType, scope)

  // Fire-and-forget: this runs at agent-spawn time inside a sync
  // getSystemPrompt() callback (called from React render in AgentDetail.tsx,
  // so it cannot be async). The spawned agent won't try to Write until after
  // a full API round-trip, by which time mkdir will have completed. Even if
  // it hasn't, FileWriteTool does its own mkdir of the parent directory.
  void ensureMemoryDirExists(memoryDir)

  const coworkExtraGuidelines =
    process.env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES
  return buildMemoryPrompt({
    displayName: 'Persistent Agent Memory',
    memoryDir,
    extraGuidelines:
      coworkExtraGuidelines && coworkExtraGuidelines.trim().length > 0
        ? [scopeNote, coworkExtraGuidelines]
        : [scopeNote],
  })
}
