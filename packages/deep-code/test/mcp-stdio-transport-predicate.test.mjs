import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isStdioTransportConfig } from '../src/services/mcp/isStdioTransportConfig.mjs'

// isStdioTransportConfig(type) is the single source of truth for "is this a
// stdio (child-process) transport" across the MCP connect/cleanup lifecycle
// (spawn, stderr wiring/teardown, child signal escalation). It must match the
// inline `type === 'stdio' || !type` form EXACTLY — the bug it fixes was the
// signal-escalation gate drifting to a strict `type === 'stdio'`, so a typeless
// `{command,args}` stdio child (the canonical .mcp.json form) was spawned but
// never got the SIGINT→SIGTERM→SIGKILL graceful shutdown.

test('explicit stdio type → true', () => {
  assert.equal(isStdioTransportConfig('stdio'), true)
})

test('the canonical typeless config (no type field → undefined) → true', () => {
  // `{command,args,env}` with no `type` key parses to type: undefined; the child
  // IS spawned, so it MUST also receive the stdio cleanup/escalation. This is the
  // case the strict gate regressed.
  assert.equal(isStdioTransportConfig(undefined), true)
  assert.equal(isStdioTransportConfig(null), true)
})

test('empty-string type is treated as "no type" (matches the inline !type form)', () => {
  // The inline gates used `!type`, not `type == null`; '' is falsy so it matched.
  // Keeping that exact semantics avoids any byte-level behavior change at the 4
  // already-correct sites.
  assert.equal(isStdioTransportConfig(''), true)
})

test('non-stdio transports → false (sse / http / ws / sse-ide)', () => {
  for (const t of ['sse', 'http', 'ws', 'sse-ide', 'http-stream']) {
    assert.equal(isStdioTransportConfig(t), false, `${t} is not stdio`)
  }
})

test('sdk (in-process, no child pid) → false — must NOT get OS signal escalation', () => {
  // This is why the predicate is narrower than isLocalMcpServer(), which returns
  // true for 'sdk'. An sdk server has no child process to SIGINT/SIGKILL.
  assert.equal(isStdioTransportConfig('sdk'), false)
})

test('byte-equivalence with the inline form across the full value space', () => {
  // Drift guard: the predicate must equal `type === 'stdio' || !type` for every
  // value the 4 byte-identical gates previously evaluated inline.
  const inline = t => t === 'stdio' || !t
  for (const t of ['stdio', 'sdk', 'sse', 'http', 'ws', 'sse-ide', '', undefined, null, 'STDIO', 'Stdio']) {
    assert.equal(isStdioTransportConfig(t), inline(t), `diverges for ${JSON.stringify(t)}`)
  }
})

test('case sensitivity matches the inline form (only lowercase "stdio" is stdio)', () => {
  // The config schema literal is lowercase 'stdio'; an uppercased value is NOT a
  // valid stdio type and (being a non-empty string) is correctly false.
  assert.equal(isStdioTransportConfig('STDIO'), false)
  assert.equal(isStdioTransportConfig('Stdio'), false)
})
