// Drop name→agentId registry entries whose agentId was just evicted.
//
// AgentTool registers a spawned async agent's name→agentId in
// AppState.agentNameRegistry (for SendMessage routing + coordinator display) but
// NOTHING ever removes it — so when applyTaskOffsetsAndEvictions deletes a
// terminal task, its registry entry lingers until the session ends: a slow
// memory leak, and a SendMessage to that name would route to a dead agent. The
// registry VALUE is the agent/task id, so prune by the evicted ids.
//
// Returns the SAME Map reference when nothing matched (referential stability so
// React state consumers don't re-render needlessly), or a new pruned Map.
//
// @param {Map<string, string>} registry  name → agentId
// @param {Iterable<string>} evictedAgentIds  the agent/task ids just removed
// @returns {Map<string, string>}
export function pruneAgentNameRegistry(registry, evictedAgentIds) {
  const evicted = evictedAgentIds instanceof Set ? evictedAgentIds : new Set(evictedAgentIds)
  if (evicted.size === 0) return registry
  let next
  for (const [name, agentId] of registry) {
    if (evicted.has(agentId)) {
      if (!next) next = new Map(registry)
      next.delete(name)
    }
  }
  return next ?? registry
}
