import assert from 'node:assert/strict'
import { test } from 'node:test'

import { paginateMcpList } from '../src/services/mcp/paginateMcpList.mjs'

const pickTools = r => r.tools ?? []

// --- single page (the byte-identical, non-paginating common case) ---

test('a single page with no nextCursor makes exactly one request', async () => {
  const cursors = []
  const items = await paginateMcpList(
    cursor => {
      cursors.push(cursor)
      return Promise.resolve({ tools: [{ name: 'a' }, { name: 'b' }] })
    },
    pickTools,
  )
  assert.deepEqual(items, [{ name: 'a' }, { name: 'b' }])
  assert.deepEqual(cursors, [undefined]) // first call gets undefined cursor
})

// --- multi-page: follow nextCursor and concatenate in order ---

test('chains pages via nextCursor, forwarding the cursor each call', async () => {
  const pages = {
    undefined: { tools: [{ name: 'a' }], nextCursor: 'c1' },
    c1: { tools: [{ name: 'b' }], nextCursor: 'c2' },
    c2: { tools: [{ name: 'c' }] }, // no nextCursor → last page
  }
  const cursors = []
  const items = await paginateMcpList(cursor => {
    cursors.push(cursor)
    return Promise.resolve(pages[String(cursor)])
  }, pickTools)
  assert.deepEqual(items, [{ name: 'a' }, { name: 'b' }, { name: 'c' }])
  assert.deepEqual(cursors, [undefined, 'c1', 'c2'])
})

test('an empty-string nextCursor terminates (treated as no more pages)', async () => {
  let calls = 0
  const items = await paginateMcpList(() => {
    calls++
    return Promise.resolve({ tools: [{ name: 'x' }], nextCursor: '' })
  }, pickTools)
  assert.equal(calls, 1)
  assert.deepEqual(items, [{ name: 'x' }])
})

// --- safety rails ---

test('maxPages caps the number of requests', async () => {
  let calls = 0
  const items = await paginateMcpList(
    () => {
      calls++
      return Promise.resolve({ tools: [{ name: String(calls) }], nextCursor: `c${calls}` })
    },
    pickTools,
    { maxPages: 3 },
  )
  assert.equal(calls, 3)
  assert.equal(items.length, 3)
})

test('maxItems caps accumulation and stops early', async () => {
  let calls = 0
  const items = await paginateMcpList(
    () => {
      calls++
      return Promise.resolve({
        tools: [{ name: 'p' }, { name: 'q' }],
        nextCursor: `c${calls}`,
      })
    },
    pickTools,
    { maxItems: 3 },
  )
  assert.equal(items.length, 3) // 2 + 1, stopped mid-page
})

test('a repeated nextCursor is a cycle and halts (no infinite loop)', async () => {
  let calls = 0
  const items = await paginateMcpList(() => {
    calls++
    // Always returns the SAME cursor — a buggy/malicious server.
    return Promise.resolve({ tools: [{ name: String(calls) }], nextCursor: 'loop' })
  }, pickTools)
  // first page (undefined→loop) then page with cursor 'loop' (loop again, already followed) → stop
  assert.equal(calls, 2)
  assert.deepEqual(items, [{ name: '1' }, { name: '2' }])
})

// --- degenerate results ---

// --- onTruncated fires (no silent cap) for each rail, not on normal end ---

test('onTruncated reports maxItems / maxPages / cursorCycle, but not a clean finish', async () => {
  const calls = []
  const onTruncated = info => calls.push(info)

  // maxItems
  await paginateMcpList(
    () => Promise.resolve({ tools: [{ name: 'a' }, { name: 'b' }], nextCursor: 'c' }),
    pickTools,
    { maxItems: 1, onTruncated },
  )
  // maxPages (server keeps advertising more)
  let n = 0
  await paginateMcpList(
    () => Promise.resolve({ tools: [{ name: String(n++) }], nextCursor: `c${n}` }),
    pickTools,
    { maxPages: 2, onTruncated },
  )
  // cursorCycle
  await paginateMcpList(
    () => Promise.resolve({ tools: [{ name: 'x' }], nextCursor: 'loop' }),
    pickTools,
    { onTruncated },
  )
  // clean finish — must NOT fire
  await paginateMcpList(
    () => Promise.resolve({ tools: [{ name: 'done' }] }),
    pickTools,
    { onTruncated },
  )

  assert.deepEqual(
    calls.map(c => c.reason),
    ['maxItems', 'maxPages', 'cursorCycle'],
  )
  assert.ok(calls.every(c => typeof c.pages === 'number' && typeof c.items === 'number'))
})

test('reaching maxItems on the final item of a cursor-less page is NOT a truncation', async () => {
  // Boundary: a server returns exactly maxItems items with no nextCursor.
  // Nothing was left behind, so onTruncated must NOT fire (no false "may be
  // missing" warning), and the full list is returned.
  const calls = []
  const items = await paginateMcpList(
    () => Promise.resolve({ tools: [{ name: 'a' }, { name: 'b' }] }), // no nextCursor
    pickTools,
    { maxItems: 2, onTruncated: info => calls.push(info) },
  )
  assert.deepEqual(items, [{ name: 'a' }, { name: 'b' }])
  assert.deepEqual(calls, []) // clean finish exactly at the cap
})

test('a missing/undefined array on a page is treated as empty', async () => {
  const items = await paginateMcpList(
    () => Promise.resolve({}), // no tools key
    pickTools,
  )
  assert.deepEqual(items, [])
})

test('a null page result is tolerated (no crash, no nextCursor)', async () => {
  const items = await paginateMcpList(() => Promise.resolve(null), r => (r?.tools ?? []))
  assert.deepEqual(items, [])
})

test('works for resources and prompts shapes (generic pickArray)', async () => {
  const res = await paginateMcpList(
    () => Promise.resolve({ resources: [{ uri: 'r1' }] }),
    r => r.resources ?? [],
  )
  assert.deepEqual(res, [{ uri: 'r1' }])
  const prompts = await paginateMcpList(
    () => Promise.resolve({ prompts: [{ name: 'p1' }] }),
    r => r.prompts ?? [],
  )
  assert.deepEqual(prompts, [{ name: 'p1' }])
})
