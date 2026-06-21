import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isConnectedIdeExtension } from '../src/utils/ideExtensionGate.mjs'

const realIde = {
  type: 'connected',
  name: 'ide',
  config: { type: 'sse-ide', scope: 'dynamic' },
}

test('the real IDE extension (dynamic scope + sse-ide/ws-ide) is recognized', () => {
  assert.equal(isConnectedIdeExtension(realIde), true)
  assert.equal(
    isConnectedIdeExtension({
      type: 'connected',
      name: 'ide',
      config: { type: 'ws-ide', scope: 'dynamic' },
    }),
    true,
  )
})

test('THE FIX: a static .mcp.json server named `ide` is rejected (scope is not dynamic)', () => {
  // A workspace/project/user/local .mcp.json server gets a non-dynamic scope from
  // the loader; even if it declares type sse-ide it can never earn 'dynamic'.
  for (const scope of ['project', 'local', 'user', 'enterprise', 'managed']) {
    for (const transport of ['stdio', 'sse', 'http', 'ws', 'sse-ide', 'ws-ide']) {
      assert.equal(
        isConnectedIdeExtension({
          type: 'connected',
          name: 'ide',
          config: { type: transport, scope },
        }),
        false,
        `scope=${scope} transport=${transport} must be rejected`,
      )
    }
  }
})

test('THE FIX: a dynamic-scoped `ide` with a non-IDE transport is rejected', () => {
  // (e.g. a plugin/computer-use dynamic server keyed 'ide' over stdio/sse/http)
  for (const transport of ['stdio', 'sse', 'http', 'ws', 'sdk', undefined]) {
    assert.equal(
      isConnectedIdeExtension({
        type: 'connected',
        name: 'ide',
        config: { type: transport, scope: 'dynamic' },
      }),
      false,
      `transport=${transport} must be rejected`,
    )
  }
})

test('a client not named `ide`, not connected, or without config is rejected', () => {
  assert.equal(isConnectedIdeExtension({ ...realIde, name: 'other' }), false)
  assert.equal(isConnectedIdeExtension({ ...realIde, type: 'failed' }), false)
  assert.equal(isConnectedIdeExtension({ type: 'connected', name: 'ide' }), false) // no config
  assert.equal(isConnectedIdeExtension(undefined), false)
  assert.equal(isConnectedIdeExtension(null), false)
})

test('the gate never trusts a name-only match (the pre-fix behavior)', () => {
  // The old matcher was `type==='connected' && name==='ide'`. Assert that shape
  // alone (the attack: a stdio .mcp.json server keyed ide) is no longer enough.
  assert.equal(
    isConnectedIdeExtension({
      type: 'connected',
      name: 'ide',
      config: { type: 'stdio', scope: 'project' },
    }),
    false,
  )
})
