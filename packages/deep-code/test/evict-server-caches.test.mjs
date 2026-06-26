import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evictServerCaches } from '../src/services/mcp/evictServerCaches.mjs'

// A cache stub that records the keys passed to delete().
function fakeCache() {
  const deleted = []
  return { deleted, delete: k => deleted.push(k) }
}

test('connection cache is deleted by the connection KEY; fetch caches by NAME', () => {
  const conn = fakeCache()
  const tools = fakeCache()
  const resources = fakeCache()
  const commands = fakeCache()
  evictServerCaches(conn, 'srv-{"type":"sse"}', [tools, resources, commands], 'srv')
  assert.deepEqual(conn.deleted, ['srv-{"type":"sse"}']) // full key, not name
  assert.deepEqual(tools.deleted, ['srv'])
  assert.deepEqual(resources.deleted, ['srv'])
  assert.deepEqual(commands.deleted, ['srv'])
})

test('every provided fetch cache is evicted (none skipped)', () => {
  const conn = fakeCache()
  const caches = [fakeCache(), fakeCache(), fakeCache(), fakeCache()]
  evictServerCaches(conn, 'k', caches, 'name')
  for (const c of caches) assert.deepEqual(c.deleted, ['name'])
})

test('an empty fetch-cache list (e.g. MCP_SKILLS off) still evicts the connection', () => {
  const conn = fakeCache()
  evictServerCaches(conn, 'k', [], 'name')
  assert.deepEqual(conn.deleted, ['k'])
})

test('the connection key and the name are NOT swapped', () => {
  const conn = fakeCache()
  const tools = fakeCache()
  evictServerCaches(conn, 'KEY', [tools], 'NAME')
  // a regression that deleted the connection cache by NAME would leak the entry
  assert.equal(conn.deleted[0], 'KEY')
  assert.notEqual(conn.deleted[0], 'NAME')
  assert.equal(tools.deleted[0], 'NAME')
})
