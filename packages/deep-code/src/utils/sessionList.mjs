import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { isTurnStart, resolveProjectSessionsDir } from './sessionFork.mjs'

// Session transcript filenames are `<uuid>.jsonl`. Matching strictly keeps the
// listing to real sessions (ignores stray files, lock files, subdirs).
const SESSION_FILE_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

// List the current project's saved sessions, newest-first, with the metadata a
// user needs to pick one to `resume`/`fork`: id, turn count, last-modified, and a
// display title. Pure + read-only: it never touches the write path or the prompt
// cache. `sessionDir` overrides the resolved project dir (tests / known callers);
// `cwd` is injectable for testing the env-based resolution; `limit` caps to the N
// most-recent.
//
// Cost is bounded: candidates are ordered by cheap `stat`s and `limit` is applied
// BEFORE any transcript is opened, and each selected transcript is STREAMED line
// by line (never read whole into memory — sessions can be very large). So
// `session list --limit 5` opens 5 files and holds one line at a time.
export async function listSessions({ sessionDir, cwd, limit, includeSidechains = false } = {}) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('limit must be a non-negative integer')
  }

  const dir = resolveProjectSessionsDir({ sessionDir, cwd })
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // No sessions dir yet → no sessions (not an error for a fresh project).
    if (error?.code === 'ENOENT') return []
    throw error
  }

  // Cheap pass: stat (no read) every session FILE so we can order by recency and
  // apply `limit` BEFORE the expensive scan.
  const candidates = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue // a dir/symlink named `<uuid>.jsonl` is not a session
    const match = SESSION_FILE_RE.exec(dirent.name)
    if (!match) continue
    const path = join(dir, dirent.name)
    let stats
    try {
      stats = await stat(path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue // raced deletion between readdir and stat
      throw error
    }
    candidates.push({ sessionId: match[1], path, modifiedMs: stats.mtimeMs })
  }

  // Newest-first; sessionId as a deterministic, locale-independent tiebreaker when
  // two files share an mtime.
  candidates.sort(
    (a, b) =>
      b.modifiedMs - a.modifiedMs ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
  )

  // Expensive pass: STREAM-scan candidates in recency order until `limit` results
  // are collected. Internal sidechain/agent transcripts are filtered by default to
  // match the /resume picker (resume.tsx filters `!isSidechain`); `--all` keeps
  // them. Filtered sidechains do NOT consume the limit budget, so we scan only as
  // many files as needed (not the whole store).
  const sessions = []
  for (const candidate of candidates) {
    if (limit !== undefined && sessions.length >= limit) break
    let scanned
    try {
      scanned = await scanSessionFile(candidate.path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue // raced deletion after stat
      throw error
    }
    const sidechain = scanned.isSidechain === true
    if (sidechain && !includeSidechains) continue
    sessions.push({
      sessionId: candidate.sessionId,
      path: candidate.path,
      modifiedMs: candidate.modifiedMs,
      turnCount: scanned.turnCount,
      sidechain,
      corrupt: scanned.corrupt,
      ...composeMetadata(scanned),
    })
  }
  return sessions
}

// Stream a transcript line by line (bounded memory) and accumulate everything the
// listing needs in ONE pass: turn count, corruption, and the title metadata.
//
// Corruption: a malformed line is forgiven ONLY as a trailing half-write AFTER at
// least one good line (the CLI killed mid-append). A malformed line followed by
// any further non-blank line is real mid-file corruption; a sole malformed line
// with no valid content is also corruption.
async function scanSessionFile(path) {
  const acc = {
    turnCount: 0,
    corrupt: false,
    isSidechain: undefined,
    agentName: undefined,
    customTitle: undefined,
    aiTitle: undefined,
    lastPrompt: undefined,
    summary: undefined,
    firstUserText: undefined,
    lastTimestamp: undefined,
  }
  let badPending = false // a malformed line not yet known to be trailing
  let parsedCount = 0

  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // A non-blank line after a malformed one proves that malformed line was NOT
      // trailing → real corruption.
      if (badPending) {
        acc.corrupt = true
        badPending = false
      }
      let entry
      try {
        entry = JSON.parse(trimmed)
      } catch {
        badPending = true
        continue
      }
      parsedCount++
      applyEntry(acc, entry)
    }
  } finally {
    rl.close()
  }
  // A still-pending malformed line is trailing: benign only if some good line
  // preceded it.
  if (badPending && parsedCount === 0) acc.corrupt = true
  return acc
}

function applyEntry(acc, entry) {
  if (!entry || typeof entry !== 'object') return
  // A session's sidechain status is set by its first message (mirrors
  // readLiteMetadata / firstMessage.isSidechain). Capture the first occurrence.
  if (acc.isSidechain === undefined && typeof entry.isSidechain === 'boolean') {
    acc.isSidechain = entry.isSidechain
  }
  switch (entry.type) {
    case 'agent-name':
      if (typeof entry.agentName === 'string') acc.agentName = entry.agentName
      break
    case 'custom-title':
      if (typeof entry.customTitle === 'string') acc.customTitle = entry.customTitle
      break
    case 'ai-title':
      if (typeof entry.aiTitle === 'string') acc.aiTitle = entry.aiTitle
      break
    case 'last-prompt':
      if (typeof entry.lastPrompt === 'string') acc.lastPrompt = entry.lastPrompt
      break
  }
  // Last string `summary` field from ANY entry — `summary` AND `task-summary`
  // entries both carry one, and readLiteMetadata (the app's reader) takes the last
  // regardless of type, so /resume can surface a rolling task summary. Match it.
  if (typeof entry.summary === 'string') acc.summary = entry.summary
  if (typeof entry.timestamp === 'string') acc.lastTimestamp = entry.timestamp
  if (isTurnStart(entry)) {
    acc.turnCount++
    // First MEANINGFUL user prompt: keep scanning past attachment-only turns
    // (turn-starts with no text) until a non-empty text prompt is found.
    if (acc.firstUserText === undefined) {
      const text = userMessageText(entry)
      if (text) acc.firstUserText = text
    }
  }
}

// Mirror the app's own session reader so `session list` shows the SAME title the
// /resume picker would (anything else is a confusing discrepancy). Two pieces of
// the codebase define this:
//   • readLiteMetadata (src/utils/sessionStorage.ts) folds an ai-title into the
//     customTitle slot (a user rename wins over an AI title) and folds the
//     last-prompt entry into firstPrompt.
//   • getLogDisplayTitle (src/utils/log.ts) resolves the displayed title as
//     agentName > customTitle > summary > firstPrompt — with `||`, so an
//     EMPTY-STRING field (e.g. a cleared custom-title) falls through.
// The TUI additionally strips display-only tags / autonomous-tick prompts for
// cosmetics; the CLI keeps the raw prompt and exposes every field in --json.
function composeMetadata(acc) {
  const resolvedTitle = acc.customTitle ?? acc.aiTitle // user rename wins (readLiteMetadata uses ??)
  const firstPrompt = acc.lastPrompt || acc.firstUserText // last-prompt wins (readLiteMetadata uses ||)
  return {
    title: acc.agentName || resolvedTitle || acc.summary || firstPrompt || '',
    agentName: acc.agentName,
    customTitle: resolvedTitle,
    summary: acc.summary,
    firstPrompt,
    lastTimestamp: acc.lastTimestamp,
  }
}

// First-line text of a user turn (a string, or the joined text blocks of a
// content array). Used only as the last-resort title fallback.
function userMessageText(entry) {
  const content = entry?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join(' ')
      .trim()
  }
  return ''
}
