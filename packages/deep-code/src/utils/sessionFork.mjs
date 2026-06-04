import { randomUUID } from 'node:crypto'
import {
  accessSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
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

// The directory holding the current project's session transcripts. Shared by
// fork (to resolve a session file) and `session list` (to enumerate them), so
// both agree on WHERE sessions live — and, crucially, with WHERE the transcript
// WRITER put them. Mirrors sessionStoragePortable.ts's canonicalizePath +
// findProjectDir so the three never diverge:
//   1. canonicalize cwd (realpath + NFC) — a symlinked cwd (/tmp → /private/tmp
//      on macOS) must map to the SAME project dir the writer used.
//   2. short paths → one deterministic dir name.
//   3. long paths (> MAX_SANITIZED_LENGTH) carry a RUNTIME-DEPENDENT hash suffix
//      (Bun.hash under the shipped CLI, djb2 under Node). Try an EXACT match for
//      every hash variant THIS runtime can compute (so a Bun reader still finds a
//      Node-written dir), and only then fall back to a prefix scan — which FAILS
//      CLOSED on ambiguity rather than picking an arbitrary same-prefix sibling
//      that could belong to a DIFFERENT project.
// `sessionDir` is an explicit literal override (tests / known callers), used
// as-is. `cwd` is injectable for tests.
export function resolveProjectSessionsDir({ sessionDir, cwd = process.cwd() } = {}) {
  if (sessionDir) return sessionDir

  const root = projectSessionsRoot()
  const canonical = canonicalizeDir(cwd)
  const base = canonical.replace(/[^a-zA-Z0-9]/g, '-')

  // 2. Short path → a single deterministic dir name.
  if (base.length <= MAX_SANITIZED_LENGTH) {
    return join(root, base)
  }

  // 3a. Long path → exact match on any hash variant THIS runtime can compute
  // (djb2 always; Bun.hash under Bun). Covers a dir written by either the Node SDK
  // (djb2) or the Bun binary (Bun.hash) when the reader can reproduce that hash.
  const prefix = base.slice(0, MAX_SANITIZED_LENGTH)
  const variants = longPathHashes(canonical)
  for (const hash of variants) {
    const exact = join(root, `${prefix}-${hash}`)
    try {
      readdirSync(exact)
      return exact
    } catch {
      /* try the next variant */
    }
  }

  // 3b. No reproducible hash matched — but a same-prefix dir MIGHT still be ours
  // under a hash this runtime can't recompute (a Bun-written dir read from the
  // Node entrypoint, or a legacy hash). Accept a candidate ONLY on a POSITIVE cwd
  // match: read a transcript's stored cwd and canonicalize it. We never trust an
  // unverifiable candidate on prefix alone — that could resolve to a DIFFERENT
  // project that merely shares the first MAX_SANITIZED_LENGTH chars. Worst case we
  // fail closed (a session is not listed), never cross projects.
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${prefix}-`)) continue
      const candidate = join(root, entry.name)
      if (projectDirMatchesCwd(candidate, canonical)) return candidate
    }
  } catch {
    /* no projects root yet */
  }

  // No positively-verified dir on disk → the primary computed path (fork reports
  // not-found, list returns []).
  return join(root, `${prefix}-${variants[0]}`)
}

// True iff this dir holds a transcript whose stored cwd canonicalizes to the
// target. Decides on the first transcript with a READABLE cwd (all transcripts in
// a project dir share one cwd). A POSITIVE match only — an unreadable cwd never
// yields true, so a same-prefix dir from a different project is never accepted.
function projectDirMatchesCwd(dir, canonical) {
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return false
  }
  for (const name of files) {
    if (!name.endsWith('.jsonl')) continue
    const storedCwd = readTranscriptCwd(join(dir, name))
    if (storedCwd === undefined) continue
    return canonicalizeDir(storedCwd) === canonical
  }
  return false
}

// The `cwd` recorded by a transcript's FIRST message — the cwd the project dir is
// NAMED after. We read ONLY line 1, bounded by LINE1_READ_CAP, never the whole
// file (sessions can be huge). It must be line 1 specifically: every message is
// stamped with its cwd at write time, so a LATER message can carry a different cwd
// (the session moved worktrees) — matching on that would resolve the wrong dir.
// undefined if line 1 (and thus its trailing cwd) exceeds the cap → fail closed.
function readTranscriptCwd(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const len = Math.min(LINE1_READ_CAP, fstatSync(fd).size)
    const buf = Buffer.alloc(len)
    const bytes = readSync(fd, buf, 0, len, 0)
    const text = buf.toString('utf8', 0, bytes)
    const newline = text.indexOf('\n')
    const line1 = newline === -1 ? text : text.slice(0, newline) // first message only
    return lastJsonStringField(line1, 'cwd')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* best-effort close */
      }
    }
  }
}

// 1 MiB: comfortably covers a large first prompt (cwd is serialized after the
// message content) while staying bounded for this rare long-path fallback.
const LINE1_READ_CAP = 1 << 20

// Value of the LAST `"key":"…"` JSON string field in `text` (handles backslash
// escapes). Last occurrence because the real field follows the message content
// (any `"key":"` appearing inside content comes earlier). undefined if absent or
// unterminated within the window.
function lastJsonStringField(text, key) {
  const marker = `"${key}":"`
  const start = text.lastIndexOf(marker)
  if (start === -1) return undefined
  let value = ''
  for (let i = start + marker.length; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      value += text[i] + (text[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '"') {
      try {
        return JSON.parse(`"${value}"`)
      } catch {
        return undefined
      }
    }
    value += ch
  }
  return undefined // unterminated within the window
}

// Hash variants for a long path, most-likely-first. djb2 (the Node writer) is
// always computable; Bun.hash (the shipped CLI writer) is added under Bun. MUST
// match sanitizePath in sessionStoragePortable.ts.
function longPathHashes(name) {
  const variants = [simpleHash(name)]
  if (typeof Bun !== 'undefined') variants.unshift(Bun.hash(name).toString(36))
  return variants
}

function projectSessionsRoot() {
  const configDir =
    process.env.DEEPCODE_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.deepcode')
  // NFC-normalize like the writer's getDeepCodeConfigHomeDir, so a config path
  // with decomposed Unicode resolves to the SAME projects root the writer used.
  return join(configDir.normalize('NFC'), 'projects')
}

// realpath + NFC, mirroring sessionStoragePortable.ts canonicalizePath; NFC-only
// fallback when realpath fails (e.g. the dir does not exist yet).
function canonicalizeDir(dir) {
  try {
    return realpathSync(dir).normalize('NFC')
  } catch {
    return dir.normalize('NFC')
  }
}

export function resolveSessionPath({ sessionDir, sessionId } = {}) {
  validateSessionId(sessionId, 'sessionId')
  return join(resolveProjectSessionsDir({ sessionDir }), `${sessionId}.jsonl`)
}

// Exported so `session show`/`rm` can validate an id BEFORE building a path — a
// strict UUID check is what prevents path traversal from a crafted id.
export function validateSessionId(sessionId, fieldName) {
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

// Parse a transcript's non-blank lines, mirroring scanSessionFile (sessionList.mjs)
// EXACTLY so `list`/`show` and `fork` AGREE on which sessions are usable:
//   - line splitting: universal newlines (\r\n, \r, \n) — readline (what the
//     scanner uses) breaks on a lone \r too, so a CR-terminated transcript must
//     tokenize identically here.
//   - per line: JSON.parse the TRIMMED text — JSON.parse rejects a leading BOM /
//     NBSP / line-separator that String.trim() strips, so the scanner (which
//     parses the trimmed line) and fork must trim before parsing or they disagree
//     on a BOM/NBSP-led line.
//   - corruption policy: a malformed LAST line with ≥1 good line before it is a
//     benign trailing half-write (the CLI was SIGKILLed mid-append) → drop it;
//     anything else (a malformed line followed by a good line, or a sole
//     malformed line) is real mid-file corruption → throw. Without this, a
//     session `list`/`show` call clean (corrupt:false) would hard-throw on `fork`.
function parseJsonl(content) {
  const lines = content
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const parsed = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    try {
      parsed.push({ entry: JSON.parse(line), line })
    } catch {
      // benign trailing half-write: the LAST line, with good content before it.
      if (index === lines.length - 1 && parsed.length > 0) break
      throw new Error(`Invalid JSONL in source session at line ${index + 1}`)
    }
  }
  return parsed
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

// Shared with `session list` so a turn number shown by `list` matches the
// `--at-turn N` accepted by `fork`.
export function countTurns(entries) {
  return entries.filter(isTurnStart).length
}

export function isTurnStart(entry) {
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

// MUST match djb2Hash (src/utils/hash.ts) + simpleHash (sessionStoragePortable.ts)
// — the transcript writer's long-path hash under Node. Diverging makes the exact
// project-dir match miss for long cwd paths written by the Node/SDK runtime
// (the Bun runtime uses Bun.hash on both sides; see longPathHashes above).
function simpleHash(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
