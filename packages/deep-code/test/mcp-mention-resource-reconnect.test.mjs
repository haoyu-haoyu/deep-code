import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readMcpResourceWithReconnect } from '../src/utils/readMcpResourceWithReconnect.mjs'
import { buildMcpResourceTextBlocks } from '../src/utils/mcpResourceBlocks.mjs'

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

// --- buildMcpResourceTextBlocks: the @-mention resource context-injection cap ---
// The resource is server-controlled and unbounded; this render path is the sole
// place its text enters the model context, so it must be size-capped like every
// other attachment + the ReadMcpResourceTool sibling.

test('a normal-sized text resource is emitted verbatim with the reassurance trailer', () => {
  const blocks = buildMcpResourceTextBlocks([{ uri: 'r', text: 'hello' }], 50_000)
  assert.deepEqual(blocks, [
    { type: 'text', text: 'Full contents of resource:' },
    { type: 'text', text: 'hello' },
    { type: 'text', text: 'Do NOT read this resource again unless you think it may have changed, since you already have the full contents.' },
  ])
})

test('an oversized text resource is truncated to the cap with a read-the-rest instruction (no false "you have the full contents")', () => {
  const big = 'A'.repeat(120_000)
  const blocks = buildMcpResourceTextBlocks([{ uri: 'r', text: big }], 50_000)
  assert.equal(blocks[0].text, 'Full contents of resource (truncated):')
  assert.ok(blocks[1].text.startsWith('A'.repeat(50_000)))
  assert.match(blocks[1].text, /truncated; 70000 of 120000 chars omitted/)
  assert.match(blocks[1].text, /use the ReadMcpResourceTool/)
  // the kept text is bounded by the cap (+ the short marker), NOT the full 120k
  assert.ok(blocks[1].text.length < 50_200, 'kept text is capped, not the full payload')
  // the misleading "you already have the full contents" trailer is NOT emitted
  assert.ok(!blocks.some(b => b.text.includes('already have the full contents')))
})

test('the cap is a TOTAL budget across items (N items cannot each ride under the cap)', () => {
  // two 30k items: first fits (30k <= 50k), second overflows the remaining 20k
  const a = 'A'.repeat(30_000)
  const b = 'B'.repeat(30_000)
  const blocks = buildMcpResourceTextBlocks([{ text: a }, { text: b }], 50_000)
  const totalText = blocks.map(x => x.text).join('').length
  assert.ok(totalText < 50_000 + 500, 'total emitted text stays within the budget (+ markers)')
  assert.ok(blocks.some(x => x.text.includes('truncated')), 'the second item is truncated')
})

test('blob items become a binary placeholder and do not consume the text budget', () => {
  const blocks = buildMcpResourceTextBlocks(
    [{ blob: 'AAAA', mimeType: 'image/png' }, { text: 'x' }],
    50_000,
  )
  assert.ok(blocks.some(b => b.text === '[Binary content: image/png]'))
  assert.ok(blocks.some(b => b.text === 'x'))
})

test('a non-finite/absent cap means unbounded (back-compat), and non-array input is safe', () => {
  const big = 'A'.repeat(200_000)
  const blocks = buildMcpResourceTextBlocks([{ text: big }], undefined)
  assert.equal(blocks[1].text, big) // verbatim, no truncation
  assert.deepEqual(buildMcpResourceTextBlocks(null, 50_000), [])
  assert.deepEqual(buildMcpResourceTextBlocks(undefined, 50_000), [])
})

test('a FINITE cap is always a hard cap: 0 truncates everything, negative clamps to 0', () => {
  // maxChars 0: a non-empty text is truncated to marker-only (kept=0)
  const zero = buildMcpResourceTextBlocks([{ text: 'abc' }], 0)
  assert.equal(zero[0].text, 'Full contents of resource (truncated):')
  assert.match(zero[1].text, /^\n\.\.\. \(truncated; 3 of 3 chars omitted/)
  // a negative cap must NOT mean "unbounded" — it clamps to 0 (the foot-gun guard)
  const neg = buildMcpResourceTextBlocks([{ text: 'A'.repeat(100) }], -5)
  assert.match(neg[1].text, /truncated; 100 of 100 chars omitted/)
  assert.ok(!neg.some(b => b.text === 'A'.repeat(100)), 'negative cap is NOT unbounded')
})

test('an empty-string text item is emitted verbatim and does not consume budget', () => {
  const blocks = buildMcpResourceTextBlocks([{ text: '' }, { text: 'B'.repeat(40_000) }], 50_000)
  // empty item: 3 verbatim blocks; second item still fits the full 50k budget
  assert.equal(blocks[1].text, '')
  assert.ok(blocks.includes(blocks.find(b => b.text === 'B'.repeat(40_000))), 'second item verbatim')
  assert.ok(!blocks.some(b => b.text.includes('truncated')))
})

test('a blob without mimeType uses the octet-stream default; null/odd items are skipped', () => {
  const blocks = buildMcpResourceTextBlocks([null, 5, { blob: 'x' }, { neither: 1 }], 50_000)
  assert.deepEqual(blocks, [{ type: 'text', text: '[Binary content: application/octet-stream]' }])
})
