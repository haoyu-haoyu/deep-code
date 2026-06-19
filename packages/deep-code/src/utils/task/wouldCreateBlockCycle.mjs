// Would adding the edge "fromTaskId blocks toTaskId" create a cycle in the
// task dependency graph?
//
// blockTask(from, to) appends `from` to `to.blockedBy` — i.e. toTaskId WAITS FOR
// fromTaskId. claimTask treats any non-completed task in `blockedBy` as an
// unresolved blocker, so a cycle in the waits-for graph is a PERMANENT DEADLOCK:
// every task in the cycle stays `blocked` forever because none can complete to
// unblock the next. The task IDs come from the orchestrating agent via
// TaskUpdateTool, so an accidental self-reference or a back-edge would wedge the
// multi-agent run.
//
// The new edge makes toTaskId wait for fromTaskId; that closes a cycle iff
// fromTaskId ALREADY (transitively) waits for toTaskId. So DFS out from
// fromTaskId along blockedBy ("waits for") edges — reaching toTaskId means the
// new toTaskId→fromTaskId edge completes a loop. A self-edge (from === to) is
// the degenerate length-1 cycle and is rejected outright.
//
// Dangling blockedBy ids (a blocker that was deleted) simply terminate that
// branch — a missing node can't be part of a live cycle.
//
// @param {string} fromTaskId
// @param {string} toTaskId
// @param {Map<string, { blockedBy?: string[] }>} tasksById  the LIVE graph, BEFORE the new edge
// @returns {boolean} true if adding the edge would create a cycle
export function wouldCreateBlockCycle(fromTaskId, toTaskId, tasksById) {
  if (fromTaskId === toTaskId) return true
  const seen = new Set()
  const stack = [fromTaskId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === toTaskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    const deps = tasksById.get(id)?.blockedBy
    if (!deps) continue
    for (const dep of deps) {
      if (!seen.has(dep)) stack.push(dep)
    }
  }
  return false
}
