import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readMcpResourceWithReconnect } from '../src/utils/readMcpResourceWithReconnect.mjs'

// The bug: the @-mention path read via the SNAPSHOT client's (possibly dead)
// transport. The fix routes through ensureConnectedClient, which returns a
// freshly-connected handle.

test('reads via the refreshed client, not the stale snapshot client', async () => {
  let staleUsed = false
  const staleClient = {
    name: 'srv',
    client: {
      async readResource() {
        // a dead transport throws here — this is what silently dropped the
        // @-mention before the fix
        staleUsed = true
        throw new Error('transport closed')
      },
    },
  }
  const freshClient = {
    name: 'srv',
    client: {
      async readResource({ uri }) {
        return { contents: [{ uri, text: 'ok' }] }
      },
    },
  }
  const ensureConnected = async c => {
    assert.equal(c, staleClient, 'reconnect is asked to refresh the snapshot handle')
    return freshClient
  }

  const result = await readMcpResourceWithReconnect(staleClient, 'file:///x', ensureConnected)
  assert.deepEqual(result, { contents: [{ uri: 'file:///x', text: 'ok' }] })
  assert.equal(staleUsed, false, 'the stale snapshot transport is never read from')
})

test('passes the exact uri through to the refreshed client', async () => {
  let seen
  const client = { client: { async readResource() {} } }
  const fresh = {
    client: {
      async readResource(args) {
        seen = args
        return { contents: [] }
      },
    },
  }
  await readMcpResourceWithReconnect(client, 'mcp://a:b:c', async () => fresh)
  assert.deepEqual(seen, { uri: 'mcp://a:b:c' })
})

test('propagates a reconnect failure (so the caller can log + drop, not hang)', async () => {
  const client = { client: { async readResource() {} } }
  await assert.rejects(
    readMcpResourceWithReconnect(client, 'u', async () => {
      throw new Error('server not connected')
    }),
    /server not connected/,
  )
})

test('propagates a read failure from the refreshed client', async () => {
  const client = { client: { async readResource() {} } }
  const fresh = {
    client: {
      async readResource() {
        throw new Error('resource gone')
      },
    },
  }
  await assert.rejects(
    readMcpResourceWithReconnect(client, 'u', async () => fresh),
    /resource gone/,
  )
})
