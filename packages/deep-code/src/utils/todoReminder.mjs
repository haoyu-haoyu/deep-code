/**
 * Render the "existing contents of your todo list" block that is appended to the
 * todo_reminder system reminder. Returns '' when there are no items (so the
 * caller can append unconditionally).
 *
 * The numbered list is appended verbatim — NOT wrapped in `[ ]`. A prior version
 * wrapped the whole multi-line list in square brackets
 * (`[1. [pending] X\n2. [pending] Y]`), producing malformed, model-facing output
 * with a stray `[` before the first item and `]` after the last. The sibling
 * task_reminder block (same file) renders its list without any wrapping, which is
 * the intended format; this matches it.
 *
 * @param {ReadonlyArray<{ status: string, content: string }>} [content]
 * @returns {string}
 */
export function buildTodoReminderBlock(content) {
  const todoItems = (content ?? [])
    .map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)
    .join('\n')
  if (todoItems.length === 0) {
    return ''
  }
  return `\n\nHere are the existing contents of your todo list:\n\n${todoItems}`
}
