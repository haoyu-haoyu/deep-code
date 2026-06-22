/**
 * Get-or-create an entry in a recency-bounded Map (MRU eviction).
 *
 * A Map preserves insertion order, so this implements a most-recently-used
 * policy: on a HIT the key is delete+re-set to move it to the tail (most
 * recently used); on a MISS the new entry is appended and, while the Map still
 * exceeds `cap`, the least-recently-used entries are evicted from the head.
 *
 * Use it to bound a Map keyed by an unbounded id space. For sentSkillNames the
 * key is a per-spawn-unique agentId, so without a bound the Map grows one
 * permanent entry per subagent spawn forever (its only removal is a global
 * clear that compaction deliberately skips). The main-thread key and any
 * actively-running agent are touched every turn → promoted to the tail → never
 * evicted; only stale/finished agents (whose unique id never recurs) are
 * reclaimed, so eviction is behavior-preserving for live agents.
 *
 * @template V
 * @param {Map<string, V>} map
 * @param {string} key
 * @param {() => V} create  factory invoked once for a missing key
 * @param {number} cap  max entries retained (>= 1); a non-finite cap disables eviction
 * @returns {V} the existing or newly-created value — the same reference stored in the map
 */
export function getOrCreateBounded(map, key, create, cap) {
  if (map.has(key)) {
    const existing = map.get(key)
    // MRU-promote: move the key to the tail so it survives eviction.
    map.delete(key)
    map.set(key, existing)
    return existing
  }
  const value = create()
  map.set(key, value)
  if (Number.isFinite(cap) && cap >= 1) {
    // Evict the oldest (head) entries until within cap. The just-inserted key
    // is at the tail, so it is never the one evicted.
    while (map.size > cap) {
      const oldest = map.keys().next().value
      map.delete(oldest)
    }
  }
  return value
}
