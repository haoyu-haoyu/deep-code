import { basename, join, sep } from 'node:path'

export const DEEPCODE_INSTRUCTION_FILE = 'DEEPCODE.md'
export const DEEPCODE_LOCAL_INSTRUCTION_FILE = 'DEEPCODE.local.md'
export const DEEPCODE_PROJECT_DIR = '.deepcode'
export const LEGACY_CLAUDE_INSTRUCTION_FILE = 'CLAUDE.md'
export const LEGACY_CLAUDE_LOCAL_INSTRUCTION_FILE = 'CLAUDE.local.md'
export const LEGACY_CLAUDE_PROJECT_DIR = '.claude'

export function createProjectInstructionPathPlan(dir) {
  return {
    primaryFiles: [
      join(dir, DEEPCODE_INSTRUCTION_FILE),
      join(dir, DEEPCODE_PROJECT_DIR, DEEPCODE_INSTRUCTION_FILE),
    ],
    primaryRulesDir: join(dir, DEEPCODE_PROJECT_DIR, 'rules'),
    legacyFiles: [
      join(dir, LEGACY_CLAUDE_INSTRUCTION_FILE),
      join(dir, LEGACY_CLAUDE_PROJECT_DIR, LEGACY_CLAUDE_INSTRUCTION_FILE),
    ],
    legacyRulesDir: join(dir, LEGACY_CLAUDE_PROJECT_DIR, 'rules'),
  }
}

export function createLocalInstructionPathPlan(dir) {
  return {
    primaryFile: join(dir, DEEPCODE_LOCAL_INSTRUCTION_FILE),
    legacyFile: join(dir, LEGACY_CLAUDE_LOCAL_INSTRUCTION_FILE),
  }
}

export function isInstructionMemoryFilePath(filePath) {
  const name = basename(filePath)
  if (
    name === DEEPCODE_INSTRUCTION_FILE ||
    name === DEEPCODE_LOCAL_INSTRUCTION_FILE ||
    name === LEGACY_CLAUDE_INSTRUCTION_FILE ||
    name === LEGACY_CLAUDE_LOCAL_INSTRUCTION_FILE
  ) {
    return true
  }
  if (!name.endsWith('.md')) {
    return false
  }
  return (
    filePath.includes(`${sep}${DEEPCODE_PROJECT_DIR}${sep}rules${sep}`) ||
    filePath.includes(`${sep}${LEGACY_CLAUDE_PROJECT_DIR}${sep}rules${sep}`)
  )
}
