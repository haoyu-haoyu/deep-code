// Parse an approved plan's markdown into discrete step strings, so the task
// panel can be DETERMINISTICALLY seeded on plan approval instead of relying on
// the model to notice an "update your todo list" nudge (Reasonix turns the same
// flow into a structural guarantee). Pure + side-effect free so it is fully
// unit-testable; the I/O (createTask) is a thin guarded wrapper at the call site.

/**
 * Extract top-level checklist steps from plan markdown.
 *
 * - Recognizes ordered (`1.`, `1)`) and unordered (`-`, `*`, `+`) list markers
 *   at column 0 only (nested/indented items are detail, not steps).
 * - Strips a leading task-checkbox (`[ ]` / `[x]`) and markdown emphasis/backticks.
 * - Ignores code fences, headings, and prose.
 * - De-duplicates (case-insensitive), preserves order, caps at `max`.
 *
 * @param {string} planMarkdown
 * @param {{ max?: number }} [options]
 * @returns {string[]} ordered, de-duplicated step texts
 */
export function parsePlanTodos(planMarkdown, { max = 20 } = {}) {
  if (typeof planMarkdown !== 'string' || planMarkdown.trim() === '') return []

  const steps = []
  let inFence = false
  for (const rawLine of planMarkdown.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // Top-level list marker at column 0 only (no leading whitespace).
    const match = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/)
    if (!match) continue

    let text = match[1]
    text = text.replace(/^\[[ xX]\]\s+/, '') // drop a task checkbox
    text = text.replace(/\*\*(.*?)\*\*/g, '$1') // unbold
    text = text.replace(/`([^`]+)`/g, '$1') // unquote inline code
    text = text.trim()
    if (text === '') continue

    steps.push(text)
  }

  const seen = new Set()
  const unique = []
  for (const step of steps) {
    const key = step.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(step)
    if (unique.length >= max) break
  }
  return unique
}

/**
 * Map parsed plan steps to TaskCreate `taskData` (Omit<Task,'id'>) shape:
 * a short subject + the full step as description, all pending. Pure.
 *
 * @param {string} planMarkdown
 * @param {{ max?: number }} [options]
 * @returns {Array<{ subject: string, description: string, status: 'pending' }>}
 */
export function planTodosToTasks(planMarkdown, options = {}) {
  return parsePlanTodos(planMarkdown, options).map(step => ({
    subject: step.length > 80 ? step.slice(0, 79).trimEnd() + '…' : step,
    description: step,
    status: 'pending',
  }))
}
