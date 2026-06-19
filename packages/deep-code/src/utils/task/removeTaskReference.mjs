// SSOT for removing a task id from another task's dependency arrays
// (blocks / blockedBy). Returns the filtered arrays plus whether anything
// changed, so the cascade's skip-when-unchanged short-circuit and the actual
// under-lock re-derive route through ONE decision and can never diverge.
//
// Pure (value-in / value-out). deleteTask applies this to the LIVE task value
// re-read INSIDE that task's lock — never to a stale snapshot — so it can only
// ever remove the deleted id and can never clobber a blocker a concurrent
// blockTask just appended.
//
// @param {{ blocks: string[], blockedBy: string[] }} task
// @param {string} taskId  the id being removed from both arrays
// @returns {{ blocks: string[], blockedBy: string[], changed: boolean }}
export function removeTaskReference(task, taskId) {
  const blocks = task.blocks.filter(id => id !== taskId)
  const blockedBy = task.blockedBy.filter(id => id !== taskId)
  const changed =
    blocks.length !== task.blocks.length ||
    blockedBy.length !== task.blockedBy.length
  return { blocks, blockedBy, changed }
}
