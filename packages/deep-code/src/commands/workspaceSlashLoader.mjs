import { readdir, readFile } from 'node:fs/promises'
import { join, parse } from 'node:path'

import { replaceAllLiteral } from '../utils/literalReplace.mjs'

const COMMAND_DIRS = [
  { dir: '.deepcode', source: 'deepcode' },
  { dir: '.cursor', source: 'cursor' },
  { dir: '.claude', source: 'claude-legacy' },
]

let warnedLegacyClaudeCommands = false

/**
 * @typedef {'deepcode' | 'cursor' | 'claude-legacy'} WorkspaceCommandSource
 * @typedef {{
 *   name: string
 *   promptTemplate: string
 *   source: WorkspaceCommandSource
 *   filePath: string
 * }} WorkspaceCommand
 */

/**
 * Load workspace-local slash commands from .deepcode/.cursor/.claude command
 * folders. Higher-priority sources win duplicate names.
 *
 * @param {string} workspaceRoot
 * @param {{warn?: (message: string) => void}=} options
 * @returns {Promise<WorkspaceCommand[]>}
 */
export async function loadWorkspaceCommands(workspaceRoot, options = {}) {
  const commandsByName = new Map()

  for (const sourceInfo of COMMAND_DIRS) {
    const commandsDir = join(workspaceRoot, sourceInfo.dir, 'commands')
    const entries = await readMarkdownEntries(commandsDir)
    if (entries.length === 0) continue

    if (
      sourceInfo.source === 'claude-legacy' &&
      !warnedLegacyClaudeCommands
    ) {
      options.warn?.(
        'Workspace slash commands loaded from .claude/commands; use .deepcode/commands instead.',
      )
      warnedLegacyClaudeCommands = true
    }

    for (const entry of entries) {
      const name = parse(entry.name).name
      if (!name || commandsByName.has(name)) continue

      const filePath = join(commandsDir, entry.name)
      const promptTemplate = await readFile(filePath, 'utf8')
      if (promptTemplate.trim().length === 0) continue

      commandsByName.set(name, {
        name,
        promptTemplate,
        source: sourceInfo.source,
        filePath,
      })
    }
  }

  return [...commandsByName.values()]
}

/**
 * @param {WorkspaceCommand} command
 * @param {string} args
 * @returns {string}
 */
export function renderWorkspaceCommandPrompt(command, args) {
  // Function replacer (via replaceAllLiteral) so $$ / $& / $` / $' in the user
  // args are inserted literally, not interpreted as replacement patterns.
  return replaceAllLiteral(command.promptTemplate, '$ARGUMENTS', args)
}

/**
 * @param {WorkspaceCommand[]} workspaceCommands
 * @returns {import('../types/command.js').Command[]}
 */
export function createWorkspaceSlashCommands(workspaceCommands) {
  return workspaceCommands.map(command => ({
    type: 'prompt',
    name: command.name,
    description: `Workspace command from ${sourceLabel(command.source)}`,
    hasUserSpecifiedDescription: false,
    argumentHint: '[arguments]',
    contentLength: command.promptTemplate.length,
    progressMessage: 'running',
    source: 'projectSettings',
    loadedFrom: 'commands_DEPRECATED',
    skillRoot: command.filePath,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: renderWorkspaceCommandPrompt(command, args),
        },
      ]
    },
  }))
}

/**
 * @param {import('../types/command.js').Command[]} existingCommands
 * @param {WorkspaceCommand[]} workspaceCommands
 * @param {{warn?: (message: string) => void}=} options
 * @returns {import('../types/command.js').Command[]}
 */
export function mergeWorkspaceSlashCommands(
  existingCommands,
  workspaceCommands,
  options = {},
) {
  if (workspaceCommands.length === 0) return existingCommands

  const existingByName = new Map()
  for (const command of existingCommands) {
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      if (!existingByName.has(name)) existingByName.set(name, command)
    }
  }

  // A workspace command carries NO frontmatter (it is rendered verbatim with
  // only $ARGUMENTS substitution). Letting it OVERRIDE a same-named command
  // that declares a restriction — `disable-model-invocation` or `allowed-tools`
  // — would silently strip that restriction (the .deepcode/commands skill-dir
  // entry is parsed WITH frontmatter, so the same file is loaded twice and the
  // unparsed workspace copy used to win). Keep the restricted command instead.
  const applicableCommands = workspaceCommands.filter(command => {
    const existing = existingByName.get(command.name)
    if (existing && commandDeclaresRestriction(existing)) {
      options.warn?.(
        `Ignoring workspace slash command /${command.name} from ${command.filePath}: it would override the restricted command /${existing.name}.`,
      )
      return false
    }
    if (existing) {
      options.warn?.(
        `Workspace slash command /${command.name} shadows existing command from ${command.filePath}`,
      )
    }
    return true
  })

  if (applicableCommands.length === 0) return existingCommands

  const applicableNames = new Set(
    applicableCommands.map(command => command.name),
  )
  const retainedCommands = existingCommands.filter(
    command => !applicableNames.has(command.name),
  )

  return [
    ...createWorkspaceSlashCommands(applicableCommands),
    ...retainedCommands,
  ]
}

// True when a command declares a frontmatter restriction that a no-frontmatter
// workspace command must not be allowed to silently override.
function commandDeclaresRestriction(command) {
  return (
    command?.disableModelInvocation === true ||
    (Array.isArray(command?.allowedTools) && command.allowedTools.length > 0)
  )
}

export function resetWorkspaceCommandWarningsForTests() {
  warnedLegacyClaudeCommands = false
}

async function readMarkdownEntries(commandsDir) {
  try {
    const entries = await readdir(commandsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return []
    }
    throw error
  }
}

function sourceLabel(source) {
  switch (source) {
    case 'deepcode':
      return '.deepcode/commands'
    case 'cursor':
      return '.cursor/commands'
    case 'claude-legacy':
      return '.claude/commands'
    default:
      return 'workspace commands'
  }
}
