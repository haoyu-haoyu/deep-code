// Shared todo-list completion logic, so the live TodoWrite tool and the
// --resume transcript restore agree on what a finished list becomes.
//
// TodoWriteTool clears its app-state list once EVERY item is completed (a
// finished list shouldn't linger in the UI). The transcript, however, records
// the model's raw tool_use INPUT — the full completed list — so a --resume that
// rebuilds app state from the transcript must apply the SAME collapse, or it
// re-hydrates a list the live session had already cleared. Both call sites
// (TodoWriteTool.call and sessionRestore.extractTodosFromTranscript) route
// through here so the rule lives in exactly one place.

/**
 * True when every todo is completed. An empty list counts as completed
 * (Array.prototype.every), matching the tool's `todos.every(...)` check.
 *
 * @param {ReadonlyArray<{ status?: string }>} todos
 * @returns {boolean}
 */
export function allTodosCompleted(todos) {
  return todos.every(todo => todo?.status === 'completed')
}

/**
 * The list TodoWrite persists to app state: an empty list once everything is
 * completed, otherwise the list unchanged. Use this when reconstructing app
 * state from the transcript so a fully-completed (and therefore cleared) list
 * is not resurrected on --resume.
 *
 * @template {{ status?: string }} T
 * @param {ReadonlyArray<T>} todos
 * @returns {ReadonlyArray<T>}
 */
export function collapseCompletedTodos(todos) {
  return allTodosCompleted(todos) ? [] : todos
}
