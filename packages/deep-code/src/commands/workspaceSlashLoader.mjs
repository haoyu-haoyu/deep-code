import { readdir, readFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { getMessage } from '../i18n/index.js'

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
        getMessage('command.workspaceSlash.legacyClaudeWarning'),
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
  return command.promptTemplate.replaceAll('$ARGUMENTS', args)
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
    progressMessage: getMessage('command.workspaceSlash.progressMessage'),
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

  const workspaceNames = new Set(workspaceCommands.map(command => command.name))
  const existingNames = new Set(
    existingCommands.flatMap(command => [
      command.name,
      ...(command.aliases ?? []),
    ]),
  )

  for (const command of workspaceCommands) {
    if (existingNames.has(command.name)) {
      options.warn?.(
        getMessage('command.workspaceSlash.shadowsWarning', {
          name: command.name,
          filePath: command.filePath,
        }),
      )
    }
  }

  const retainedCommands = existingCommands.filter(
    command => !workspaceNames.has(command.name),
  )

  return [
    ...createWorkspaceSlashCommands(workspaceCommands),
    ...retainedCommands,
  ]
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
