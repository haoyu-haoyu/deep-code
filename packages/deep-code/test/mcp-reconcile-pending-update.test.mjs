import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldApplyPendingMcpUpdate } from '../src/services/mcp/reconcilePendingMcpUpdate.mjs'

// A coalesced MCP server update (buffered ~16ms before flushPendingUpdates runs)
// must not RESURRECT a server the user disabled in the window. A list_changed
// handler's in-flight fetch can resolve AFTER a /mcp disable and re-add the
// server as 'connected' with live tools; the flush must re-check the disk truth.

const disabled = name => name === 'weather' // 'weather' is disabled on disk

test('skips a late connected update for a server disabled on disk (the bug)', () => {
  assert.equal(
    shouldApplyPendingMcpUpdate({ type: 'connected', name: 'weather' }, disabled),
    false,
  )
})

test('skips every non-terminal type for a disk-disabled server (pending, needs-auth)', () => {
  // the real MCPServerConnection.type union's non-terminal members
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'pending', name: 'weather' }, disabled), false)
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'needs-auth', name: 'weather' }, disabled), false)
  // forward-compat: an unknown (future) non-terminal type is also gated (fail-safe)
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'some-future-type', name: 'weather' }, disabled), false)
})

test('ALWAYS applies a terminal update (the disable itself, and failures)', () => {
  // the disable's own {type:'disabled'} update must land even though disk says disabled
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'disabled', name: 'weather' }, disabled), true)
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'failed', name: 'weather' }, disabled), true)
})

test('applies a connected update for a server NOT disabled on disk (no regression)', () => {
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'connected', name: 'github' }, disabled), true)
})

test('a re-ENABLED server applies normally (disabled flag cleared on disk → not disabled)', () => {
  // after enable, isDisabledOnDisk('weather') would be false; simulate with a fresh predicate
  const noneDisabled = () => false
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'connected', name: 'weather' }, noneDisabled), true)
})

test('a malformed/nameless update is not silently dropped (defensive — caller handles as before)', () => {
  assert.equal(shouldApplyPendingMcpUpdate({ type: 'connected' }, disabled), true)
  assert.equal(shouldApplyPendingMcpUpdate(null, disabled), true)
  assert.equal(shouldApplyPendingMcpUpdate({ name: 42, type: 'connected' }, disabled), true)
})

test('a disk-disabled gate is only consulted for non-terminal updates', () => {
  // terminal short-circuits before isDisabledOnDisk is even called
  let consulted = false
  const spy = name => { consulted = true; return true }
  shouldApplyPendingMcpUpdate({ type: 'disabled', name: 'x' }, spy)
  assert.equal(consulted, false, 'terminal update must not consult the disk gate')
  shouldApplyPendingMcpUpdate({ type: 'connected', name: 'x' }, spy)
  assert.equal(consulted, true, 'non-terminal update consults the disk gate')
})
