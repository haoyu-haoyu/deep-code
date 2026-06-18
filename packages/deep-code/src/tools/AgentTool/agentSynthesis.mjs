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

// --- LLM synthesis (the optional distillation tier; deterministic fallback above) ---
//
// The files manifest recovers WHICH files were touched, deterministically. The
// LLM synthesis (a warm-cache fork over the finished subagent transcript) recovers
// WHAT was found — distilling the per-turn narration into findings/decisions/
// followups. These leaves are the pure, node-testable pieces; the .ts caller owns
// the fork. filesTouched is ALWAYS the deterministic extractFilesTouched output
// (never LLM-derived), so a hallucination can never invent a file path.

/**
 * Every non-empty assistant text block, in order — the per-turn narration the
 * subagent produced (the final entry is its sign-off). Feeds the synthesis fork.
 * @param {readonly unknown[]} agentMessages
 * @returns {string[]}
 */
export function extractAssistantNarration(agentMessages) {
  const narration = []
  for (const message of agentMessages) {
    if (!message || typeof message !== 'object') continue
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block?.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.trim()
      ) {
        narration.push(block.text.trim())
      }
    }
  }
  return narration
}

// The synthesis fork is asked for this line-based section format — far more robust
// to parse from free text than JSON (DeepSeek has no json_schema on the fork path).
export const SUBAGENT_SYNTHESIS_PROMPT = [
  'You have finished the delegated task. Summarize it for the agent that delegated it — concrete and factual, never invent results. Output ONLY the sections below, each as "- " bullets, and OMIT any section that is empty. No preamble, no closing remarks.',
  '',
  'FINDINGS:',
  '- a key thing you discovered or did',
  'DECISIONS:',
  '- a decision you made, and why',
  'FOLLOWUPS:',
  '- anything left to do or worth the delegator knowing',
].join('\n')

const SYNTH_SECTION_ALIASES = new Map([
  ['findings', 'findings'],
  ['finding', 'findings'],
  ['decisions', 'decisions'],
  ['decision', 'decisions'],
  ['followups', 'followups'],
  ['follow-ups', 'followups'],
  ['follow ups', 'followups'],
  ['next steps', 'followups'],
])
const MAX_SYNTH_ITEMS = 12
const MAX_SYNTH_ITEM_CHARS = 500

/**
 * Defensively parse the synthesis fork's free-text output into
 * {findings, decisions, followups} (string[] each), tolerant of missing sections,
 * stray prose, varied bullet glyphs and casing. Returns null when nothing parses
 * (the caller then keeps the deterministic files manifest).
 * @param {string} text
 * @returns {{ findings: string[], decisions: string[], followups: string[] } | null}
 */
export function parseSynthesisOutput(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const out = { findings: [], decisions: [], followups: [] }
  let current = null
  const push = value => {
    const item = String(value).trim().slice(0, MAX_SYNTH_ITEM_CHARS)
    if (item && current && out[current].length < MAX_SYNTH_ITEMS) {
      out[current].push(item)
    }
  }
  const sectionFor = label => SYNTH_SECTION_ALIASES.get(label.trim().toLowerCase())
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // Strip markdown HEADER decoration (#, ##, **bold**, *italic*) — but NOT a
    // "* "/"- " bullet glyph: a leading star counts as emphasis only when it is
    // immediately followed by a non-space, so "* item" stays a bullet.
    const deco = line
      .replace(/^#+\s*/, '')
      .replace(/^\*+(?=\S)/, '')
      .replace(/\*+$/, '')
      .trim()
    // "FINDINGS:" / "FINDINGS: inline content" / "Findings :" — a known label
    // followed by a colon (with optional inline content captured as the first item).
    const colonHeader = deco.match(/^([A-Za-z][A-Za-z \-]*?)\s*[:：]\s*(.*)$/)
    if (colonHeader && SYNTH_SECTION_ALIASES.has(colonHeader[1].trim().toLowerCase())) {
      current = sectionFor(colonHeader[1])
      if (colonHeader[2]) push(colonHeader[2])
      continue
    }
    // A bare label with no colon ("Decisions").
    if (SYNTH_SECTION_ALIASES.has(deco.toLowerCase())) {
      current = sectionFor(deco)
      continue
    }
    // A bullet — matched on the ORIGINAL line so a "* item" bullet is not eaten by
    // the emphasis strip above.
    const bullet = line.match(/^[-*•·]\s+(.+)$/)
    if (bullet) push(bullet[1])
  }
  if (
    out.findings.length === 0 &&
    out.decisions.length === 0 &&
    out.followups.length === 0
  ) {
    return null
  }
  return out
}

/**
 * The cache-prefix-stable synthesis block, or '' when there's nothing to report.
 * FIXED section order (findings, files, decisions, followups), omit-empty, no
 * timestamps/IDs — so it splices into the parent prefix without churning bytes.
 * `filesTouched` is the DETERMINISTIC extractFilesTouched output (never LLM-derived).
 * @param {{ findings?: string[], decisions?: string[], followups?: string[], filesTouched?: { read?: string[], modified?: string[] } }} parts
 * @returns {string}
 */
export function buildSubagentSynthesisBlock(parts = {}) {
  const findings = Array.isArray(parts.findings) ? parts.findings : []
  const decisions = Array.isArray(parts.decisions) ? parts.decisions : []
  const followups = Array.isArray(parts.followups) ? parts.followups : []
  const modified = parts.filesTouched?.modified ?? []
  const read = parts.filesTouched?.read ?? []

  const sections = []
  if (findings.length) {
    sections.push('findings:\n' + findings.map(f => `- ${f}`).join('\n'))
  }
  const fileLines = []
  if (modified.length) fileLines.push(`modified: ${modified.join(', ')}`)
  if (read.length) fileLines.push(`read: ${read.join(', ')}`)
  if (fileLines.length) sections.push(fileLines.join('\n'))
  if (decisions.length) {
    sections.push('decisions:\n' + decisions.map(d => `- ${d}`).join('\n'))
  }
  if (followups.length) {
    sections.push('followups:\n' + followups.map(u => `- ${u}`).join('\n'))
  }
  if (sections.length === 0) return ''
  return `<subagent-synthesis>\n${sections.join('\n')}\n</subagent-synthesis>`
}
