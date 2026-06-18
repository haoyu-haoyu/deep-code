// Deterministic structured digest of a finished subagent's transcript.
//
// finalizeAgentTool() returns ONLY the last assistant message's text as the
// parent-visible result. When a subagent does substantial multi-turn work and
// signs off tersely ("Done."), the parent never learns which files the subagent
// read or modified — it re-derives that by re-scanning, defeating the point of
// delegating. This leaf distills the transcript into a compact, high-signal
// manifest the parent (or a dependent DAG agent) can consume directly: the files
// touched (read vs. modified, from tool inputs). It is the structured handoff
// contract; it is also the deterministic fallback layer for a future LLM
// synthesis pass that distills the findings themselves.
//
// Pure & deterministic — no LLM call, no cache impact, fully unit-testable. The
// caller decides (flag-gated) whether to attach the trailer to the result.

// Tools that READ a specific file. Notebooks are read via the plain Read tool,
// so Read (file_path) is the only file-reading tool in this codebase.
const READ_TOOLS = new Set(['Read'])
// Tools that MODIFY a specific file on disk.
const MODIFY_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** The file path a file-op tool_use names, or undefined for non-file tools. */
function toolUseFilePath(input) {
  if (!input || typeof input !== 'object') return undefined
  // Read/Edit/Write use `file_path`; NotebookEdit uses `notebook_path`.
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' && path.trim() ? path : undefined
}

/**
 * Files the subagent read vs. modified, deduplicated, in first-seen order. A file
 * that was modified is reported only under `modified` (never also under `read`),
 * since "modified" is the stronger statement.
 * @param {readonly unknown[]} agentMessages
 * @returns {{ read: string[], modified: string[] }}
 */
export function extractFilesTouched(agentMessages) {
  const read = []
  const modified = []
  const readSeen = new Set()
  const modifiedSeen = new Set()
  for (const message of agentMessages) {
    if (!message || typeof message !== 'object') continue
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue
      const path = toolUseFilePath(block.input)
      if (!path) continue
      if (MODIFY_TOOLS.has(block.name)) {
        if (!modifiedSeen.has(path)) {
          modifiedSeen.add(path)
          modified.push(path)
        }
      } else if (READ_TOOLS.has(block.name)) {
        if (!readSeen.has(path)) {
          readSeen.add(path)
          read.push(path)
        }
      }
    }
  }
  // A modified file outranks a read of the same file.
  return { read: read.filter(path => !modifiedSeen.has(path)), modified }
}

/**
 * The compact structured manifest text, or '' when no files were touched (so the
 * caller adds nothing and the result is byte-identical to the pre-feature output).
 * Wrapped in a <subagent-files> tag so the parent can parse or ignore it.
 * @param {readonly unknown[]} agentMessages
 * @returns {string}
 */
export function buildFilesTouchedManifest(agentMessages) {
  const { read, modified } = extractFilesTouched(agentMessages)
  if (read.length === 0 && modified.length === 0) return ''
  const lines = []
  if (modified.length > 0) lines.push(`modified: ${modified.join(', ')}`)
  if (read.length > 0) lines.push(`read: ${read.join(', ')}`)
  return `<subagent-files>\n${lines.join('\n')}\n</subagent-files>`
}
