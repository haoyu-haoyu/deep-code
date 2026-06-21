import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gateAgentBypassPermissionMode } from '../src/tools/AgentTool/agentBypassPermissionGate.mjs'

test('THE FIX: an agent-requested bypassPermissions is dropped when the killswitch is active', () => {
  // killswitch ON → bypass override removed (undefined = "do not apply", parent mode stands)
  assert.equal(gateAgentBypassPermissionMode('bypassPermissions', true), undefined)
})

test('an agent-requested bypassPermissions is honored when the killswitch is OFF', () => {
  // killswitch OFF → design-consistent with sibling mcpServers/hooks gates: a
  // folder-trusted agent may request bypass; the documented feature still works.
  assert.equal(
    gateAgentBypassPermissionMode('bypassPermissions', false),
    'bypassPermissions',
  )
})

test('every non-bypass mode passes through unchanged regardless of the killswitch', () => {
  for (const disabled of [true, false]) {
    assert.equal(gateAgentBypassPermissionMode('acceptEdits', disabled), 'acceptEdits')
    assert.equal(gateAgentBypassPermissionMode('plan', disabled), 'plan')
    assert.equal(gateAgentBypassPermissionMode('default', disabled), 'default')
    assert.equal(gateAgentBypassPermissionMode('dontAsk', disabled), 'dontAsk')
    assert.equal(gateAgentBypassPermissionMode('auto', disabled), 'auto')
    assert.equal(gateAgentBypassPermissionMode('bubble', disabled), 'bubble')
  }
})

test('an undefined input stays undefined (no override requested → no override applied)', () => {
  // runAgent.ts guards the override with `if (effectiveMode && ...)`, so an
  // undefined agent permissionMode must remain undefined and NOT be elevated.
  assert.equal(gateAgentBypassPermissionMode(undefined, true), undefined)
  assert.equal(gateAgentBypassPermissionMode(undefined, false), undefined)
})

test('the gate never elevates: it only ever removes a disabled bypass', () => {
  // No input/killswitch combination produces bypassPermissions unless the agent
  // already asked for it AND the killswitch is off.
  const modes = ['acceptEdits', 'plan', 'default', 'dontAsk', 'auto', 'bubble', undefined]
  for (const m of modes) {
    for (const disabled of [true, false]) {
      assert.notEqual(
        gateAgentBypassPermissionMode(m, disabled),
        'bypassPermissions',
      )
    }
  }
})
