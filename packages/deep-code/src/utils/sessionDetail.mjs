import { createReadStream } from 'node:fs'
import { lstat, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { resolveProjectSessionsDir, validateSessionId } from './sessionFork.mjs'
import { composeMetadata, scanSessionFile } from './sessionList.mjs'

// The transcript file + the session's sub-agent subdir for a given id, resolved
// against the SAME project dir `session list`/`fork` use. validateSessionId runs
// FIRST so a crafted id (e.g. "../../etc/passwd") can never escape the dir.
function resolveSessionPaths({ sessionId, sessionDir, cwd } = {}) {
  validateSessionId(sessionId, 'sessionId')
  const projectDir = resolveProjectSessionsDir({ sessionDir, cwd })
  return {
    file: join(projectDir, `${sessionId}.jsonl`),
    subdir: join(projectDir, sessionId), // <projectDir>/<id>/subagents/… lives here
  }
}

// Rich metadata for a single session — the same title/turn semantics as
// `session list` (shared scanner, so `show` and `list` can never disagree) plus
// message count, cwd, gitBranch, and first/last timestamps. Returns
// { exists: false } when the transcript is absent (the caller reports not-found).
export async function getSessionDetail({ sessionId, sessionDir, cwd } = {}) {
  const { file } = resolveSessionPaths({ sessionId, sessionDir, cwd })

  let stats
  try {
    // lstat (not stat): do NOT follow symlinks. `session list` only lists regular
    // files (dirent.isFile()), so a planted `<uuid>.jsonl` symlink must be
    // invisible here too — both for list/show consistency and so `show` can't be
    // tricked into reading a file outside the project store.
    stats = await lstat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { sessionId, path: file, exists: false }
    throw error
  }
  if (!stats.isFile()) return { sessionId, path: file, exists: false }

  let acc
  try {
    acc = await scanSessionFile(file)
  } catch (error) {
    // Raced deletion between lstat and the streamed read → treat as not-found,
    // matching listSessions' analogous race handling.
    if (error?.code === 'ENOENT') return { sessionId, path: file, exists: false }
    throw error
  }
  return {
    sessionId,
    path: file,
    exists: true,
    modifiedMs: stats.mtimeMs,
    turnCount: acc.turnCount,
    messageCount: acc.messageCount,
    sidechain: acc.isSidechain === true,
    corrupt: acc.corrupt,
    cwd: acc.cwd,
    gitBranch: acc.gitBranch,
    firstTimestamp: acc.firstTimestamp,
    ...composeMetadata(acc),
  }
}

// Delete a session: its transcript file AND its sub-agent subdir
// (<projectDir>/<id>/, where sub-agent transcripts live). Idempotent — removing a
// non-existent session reports existed:false rather than throwing. Returns the
// paths actually removed.
export async function removeSession({ sessionId, sessionDir, cwd } = {}) {
  const { file, subdir } = resolveSessionPaths({ sessionId, sessionDir, cwd })

  const removed = []
  try {
    await unlink(file)
    removed.push(file)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  // Remove the sub-agent subdir if present. NO force: ENOENT (the common case —
  // most sessions have no sub-agents) is expected and ignored, but a REAL error
  // (EACCES/IO) is surfaced rather than silently swallowed. Track it in `removed`
  // only when actually deleted, so the reported count is accurate.
  try {
    await rm(subdir, { recursive: true })
    removed.push(subdir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  // existed = anything was actually removed — so deleting an ORPHANED sub-agent
  // subdir (transcript already gone) still reports success rather than not-found.
  return { sessionId, path: file, removed, existed: removed.length > 0 }
}

// Stream a transcript to `write`, one rendered message at a time (memory-bounded;
// never reads the whole file). format: 'markdown' (default, human-readable) or
// 'json' (a JSON array of the conversation messages). Like getSessionDetail it
// lstat-rejects symlinks/non-files and treats a deletion race as not-found.
// Returns { exists }. Corrupt lines are skipped (lenient, like listSessions).
export async function exportSession({ sessionId, sessionDir, cwd, format = 'markdown', write } = {}) {
  const { file } = resolveSessionPaths({ sessionId, sessionDir, cwd })

  let stats
  try {
    stats = await lstat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    throw error
  }
  if (!stats.isFile()) return { exists: false }

  const json = format === 'json'
  let count = 0
  const input = createReadStream(file, 'utf8')
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let entry
      try {
        entry = JSON.parse(trimmed)
      } catch {
        continue // skip a corrupt/partial line (lenient, mirrors listSessions)
      }
      // `await` each write so a `write` that honors backpressure (awaits 'drain')
      // pauses the read — keeping memory bounded end-to-end on a slow consumer.
      if (json) {
        const obj = exportEntryJson(entry)
        if (obj === null) continue
        await write(count === 0 ? '[\n' : ',\n')
        await write(JSON.stringify(obj))
        count++
      } else {
        const md = renderEntryMarkdown(entry)
        if (md === null) continue
        await write(count === 0 ? '' : '\n')
        await write(md)
        count++
      }
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false } // raced deletion after lstat
    throw error
  } finally {
    rl.close()
    input.destroy()
  }

  if (json) await write(count === 0 ? '[]\n' : '\n]\n')
  else await write('\n')
  return { exists: true }
}

// Render ONE transcript entry as a markdown message block, or null to skip it
// (metadata entries, progress, etc. — only user/assistant turns are rendered).
export function renderEntryMarkdown(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.type !== 'user' && entry.type !== 'assistant') return null
  const body = renderContentMarkdown(entry.message?.content)
  if (!body) return null
  const heading = entry.type === 'user' ? '## User' : '## Assistant'
  return `${heading}\n\n${body}`
}

// The conversation-message view of ONE entry for `--format json`, or null to skip.
// Skips empty-content turns too, so json and markdown include the SAME set of
// messages (no count mismatch between the two formats).
export function exportEntryJson(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.type !== 'user' && entry.type !== 'assistant') return null
  if (isEmptyMessageContent(entry.message?.content)) return null
  return {
    type: entry.type,
    role: entry.message?.role,
    content: entry.message?.content,
    timestamp: entry.timestamp,
  }
}

// THE single predicate for "does this content block produce export output" —
// shared by emptiness detection AND markdown rendering so the two can never
// disagree on which turns to drop. A block has content iff it is text with a
// non-empty trimmed string, or a non-text block with a truthy `type`
// (tool_use/tool_result/image/document/…). A typeless/garbage block has none.
function blockHasRenderableContent(block) {
  if (!block || typeof block !== 'object') return false
  if (block.type === 'text') return typeof block.text === 'string' && block.text.trim() !== ''
  return Boolean(block.type)
}

// A message has nothing to export when its content is an empty/whitespace string,
// a non-array non-string, or an array with no renderable blocks (so attachment-only
// turns are KEPT, but a typeless/garbage-block array is dropped — matching markdown).
function isEmptyMessageContent(content) {
  if (typeof content === 'string') return content.trim() === ''
  if (!Array.isArray(content)) return true
  return !content.some(blockHasRenderableContent)
}

// A markdown code fence whose backtick run is longer than any in `body`, so the
// body can never terminate the fence early (CommonMark-safe).
function codeFence(body, lang = '') {
  let maxRun = 0
  let run = 0
  for (const ch of body) {
    if (ch === '`') {
      run++
      if (run > maxRun) maxRun = run
    } else {
      run = 0
    }
  }
  const fence = '`'.repeat(Math.max(3, maxRun + 1))
  return `${fence}${lang}\n${body}\n${fence}`
}

function renderContentMarkdown(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!blockHasRenderableContent(block)) continue // same predicate as isEmptyMessageContent
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text.trim())
    } else if (block.type === 'tool_use') {
      // Inline-code the name + a length-safe fence so a tool input containing
      // backticks (e.g. pasted code) can't break out of the code block.
      parts.push(`_[tool: \`${block.name ?? '?'}\`]_\n\n${codeFence(safeStringify(block.input), 'json')}`)
    } else if (block.type === 'tool_result') {
      parts.push(`_[tool result]_\n\n${renderToolResultContent(block.content)}`)
    } else if (block.type) {
      // image / document / any other block → an explicit placeholder, so the turn
      // is never silently dropped or mis-rendered as empty.
      parts.push(`_[${block.type}]_`)
    }
  }
  return parts.filter(Boolean).join('\n\n')
}

function renderToolResultContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text' && typeof block.text === 'string') return block.text.trim()
      return block.type ? `_[${block.type}]_` : '' // non-text result (e.g. image) → placeholder
    })
    .filter(Boolean)
    .join('\n\n')
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}
