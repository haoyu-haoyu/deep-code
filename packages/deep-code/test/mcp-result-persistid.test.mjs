import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mcpLargeResultPersistId } from '../src/services/mcp/mcpResultPersistId.mjs'

test('persistId has the expected mcp-<server>-<tool>-<ts>-<rand> shape', () => {
  const id = mcpLargeResultPersistId('myserver', 'search')
  assert.match(id, /^mcp-myserver-search-\d+-[0-9a-z]+$/)
})

test('two same-server/same-tool ids are distinct even in the same millisecond', () => {
  // The bug: a bare `mcp-<server>-<tool>-<Date.now()>` id collides for two
  // concurrent calls in the same ms, and persistToolResult's EEXIST-skip then
  // serves the first call's file for the second call's result. The random suffix
  // must make every invocation distinct. Generate a large batch in a tight loop
  // (many share a Date.now() ms) and require ZERO collisions.
  const ids = new Set()
  const N = 20000
  for (let i = 0; i < N; i++) {
    ids.add(mcpLargeResultPersistId('srv', 'tool'))
  }
  assert.equal(ids.size, N, 'every id must be unique (no same-ms collision)')
})

test('distinct server/tool names produce distinct id prefixes', () => {
  const a = mcpLargeResultPersistId('s1', 't1')
  const b = mcpLargeResultPersistId('s2', 't2')
  assert.match(a, /^mcp-s1-t1-/)
  assert.match(b, /^mcp-s2-t2-/)
})
