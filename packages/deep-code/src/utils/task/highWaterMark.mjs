// The task-list high-water mark is the SOLE id-reuse guard once task files are
// unlinked: createTask allocates max(highest-file-id, HWM) + 1. The HWM must
// therefore NEVER decrease — a write only ever raises it to max(current,
// candidate). Routing every writer (deleteTask retiring an id, resetTaskList
// recording the highest existing id) through this one pure decision keeps them
// from diverging, and — when the read-then-decide-then-write runs inside the
// list lock — makes the bump monotonic so a stale snapshot can't clobber a
// higher mark back DOWN below an already-issued id (which would let a later
// createTask silently re-issue that id, colliding with a still-referenced task
// in another agent's blockedBy/blocks/owner).
//
// @param {number} current   the HWM just re-read (under the list lock)
// @param {number} candidate the id being retired (delete) or the highest file id (reset)
// @returns {number|null} the value to durably write, or null when no write is needed
export function nextHighWaterMark(current, candidate) {
  if (!Number.isInteger(candidate) || candidate <= current) return null
  return candidate
}
