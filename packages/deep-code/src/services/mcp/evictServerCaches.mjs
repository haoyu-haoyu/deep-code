/**
 * Evict an MCP server's memoized connection cache entry and its per-server
 * fetch caches (tools / resources / commands / skills).
 *
 * Two key spaces are in play and must not be mixed up:
 *   - the connection cache (connectToServer.cache) is keyed by name+config
 *     (the `connectionKey` from getServerCacheKey), while
 *   - the fetch caches are keyed by the bare server `name`.
 *
 * clearServerCache must call this BEFORE awaiting the connection's cleanup().
 * During that async close, a connectToServer racing the clear (e.g. a tool call
 * via ensureConnectedClient while a reconnect is in flight) would otherwise hit
 * the still-cached, now-closing client and fail with "Connection closed".
 * Evicting first makes that racer miss the cache and open a fresh connection.
 *
 * @param {{ delete(key: string): unknown }} connectionCache  connectToServer.cache
 * @param {string} connectionKey                              getServerCacheKey(name, config)
 * @param {ReadonlyArray<{ delete(key: string): unknown }>} fetchCaches  name-keyed fetch caches
 * @param {string} name
 */
export function evictServerCaches(
  connectionCache,
  connectionKey,
  fetchCaches,
  name,
) {
  connectionCache.delete(connectionKey)
  for (const cache of fetchCaches) {
    cache.delete(name)
  }
}
