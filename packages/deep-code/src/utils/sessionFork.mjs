import { randomUUID } from 'node:crypto'
import { accessSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SANITIZED_LENGTH = 200

export async function forkSession({
  atTurn,
  createSessionId = randomUUID,
  sessionDir,
  sourceSessionId,
} = {}) {
  validateSessionId(sourceSessionId, 'sourceSessionId')
  validateAtTurn(atTurn)

  const sourcePath = resolveSessionPath({ sessionDir, sessionId: sourceSessionId })
  const sourceContent = readSourceSession(sourcePath, sourceSessionId)
  const sourceLines = parseJsonl(sourceContent)
  const totalTurns = countTurns(sourceLines.map(item => item.entry))

  if (totalTurns === 0) {
    throw new Error(`Session ${sourceSessionId} has no turns to fork`)
  }

  const forkedAtTurn = atTurn ?? totalTurns
  if (forkedAtTurn > totalTurns) {
    throw new Error(`atTurn ${forkedAtTurn} exceeds session turn count ${totalTurns}`)
  }

  const targetDir = dirname(sourcePath)
  const newSessionId = await createUniqueSessionId(targetDir, createSessionId)
  const forkedLines = sourceLines
    .slice(0, findCopyLineCount(sourceLines, forkedAtTurn))
    .map(({ entry }) => JSON.stringify(restampSessionId(entry, newSessionId)))

  mkdirSync(targetDir, { recursive: true })
  writeFileSync(
    join(targetDir, `${newSessionId}.jsonl`),
    forkedLines.join('\n') + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )

  return {
    forkedAtTurn,
    forkedFromSessionId: sourceSessionId,
    newSessionId,
    turnCount: forkedAtTurn,
  }
}

export function resolveSessionPath({ sessionDir, sessionId } = {}) {
  validateSessionId(sessionId, 'sessionId')
  if (sessionDir) return join(sessionDir, `${sessionId}.jsonl`)

  const configDir =
    process.env.DEEPCODE_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.deepcode')
  return join(configDir, 'projects', sanitizePath(process.cwd()), `${sessionId}.jsonl`)
}

function validateSessionId(sessionId, fieldName) {
  if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) {
    throw new Error(`${fieldName} must be a UUID session id`)
  }
}

function validateAtTurn(atTurn) {
  if (atTurn === undefined) return
  if (!Number.isInteger(atTurn) || atTurn <= 0) {
    throw new Error('atTurn must be a positive integer')
  }
}

function readSourceSession(sourcePath, sourceSessionId) {
  try {
    return readFileSync(sourcePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Session ${sourceSessionId} not found`)
    }
    throw error
  }
}

function parseJsonl(content) {
  const lines = content.split('\n').filter(line => line.trim().length > 0)
  return lines.map((line, index) => {
    try {
      return { entry: JSON.parse(line), line }
    } catch {
      throw new Error(`Invalid JSONL in source session at line ${index + 1}`)
    }
  })
}

function findCopyLineCount(sourceLines, targetTurn) {
  let currentTurn = 0
  for (let index = 0; index < sourceLines.length; index++) {
    if (isTurnStart(sourceLines[index].entry)) {
      currentTurn++
      if (currentTurn > targetTurn) return index
    }
  }
  return sourceLines.length
}

function countTurns(entries) {
  return entries.filter(isTurnStart).length
}

function isTurnStart(entry) {
  if (entry?.type !== 'user' || entry.isMeta === true) return false
  const content = entry.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  if (Array.isArray(content)) {
    return content.some(block =>
      block?.type === 'text' ||
      block?.type === 'image' ||
      block?.type === 'document')
  }
  return false
}

function restampSessionId(entry, newSessionId) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return { ...entry, sessionId: newSessionId }
  }
  return entry
}

async function createUniqueSessionId(sessionDir, createSessionId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = createSessionId()
    validateSessionId(candidate, 'newSessionId')
    try {
      accessSync(join(sessionDir, `${candidate}.jsonl`))
    } catch (error) {
      if (error?.code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new Error('Unable to allocate a unique fork session id')
}

function sanitizePath(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(name)}`
}

function simpleHash(str) {
  let hash = 5381
  for (let index = 0; index < str.length; index++) {
    hash = (hash * 33) ^ str.charCodeAt(index)
  }
  return Math.abs(hash >>> 0).toString(36)
}
