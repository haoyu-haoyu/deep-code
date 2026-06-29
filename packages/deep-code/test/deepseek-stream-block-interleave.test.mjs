import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDeepSeekCallModel } from '../src/query/deepseek-call-model.mjs'

// Drive the REAL streaming assembler with a stub provider whose streamQuery
// yields a chosen sequence of provider events, then inspect the content_block
// lifecycle it emits. `supports` is true ONLY for reasoning_content so the
// reasoning path is exercised without tripping the cache-breakpoint side effects.
function makeProvider(events) {
  return {
    supports: cap => cap === 'reasoning_content',
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      for (const e of events) yield e
    },
  }
}

async function run(events) {
  const gen = createDeepSeekCallModel({ provider: makeProvider(events) })({
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: [],
    tools: [],
    options: {},
  })
  const blockEvents = []
  let assistant
  for await (const m of gen) {
    if (m.type === 'stream_event') {
      const e = m.event
      if (
        e.type === 'content_block_start' ||
        e.type === 'content_block_delta' ||
        e.type === 'content_block_stop'
      ) {
        blockEvents.push(e)
      }
    } else {
      assistant = m
    }
  }
  return { blockEvents, assistant }
}

// A well-formed content_block stream: every start opens a fresh index, every
// delta targets a currently-open index, every stop closes an open index, and
// nothing is left open. Returns the ordered [index, type] of each start.
function assertWellFormed(blockEvents) {
  const open = new Map()
  const starts = []
  for (const e of blockEvents) {
    if (e.type === 'content_block_start') {
      assert.ok(
        !open.has(e.index),
        `two content_block_start collided on index ${e.index}`,
      )
      open.set(e.index, e.content_block?.type)
      starts.push([e.index, e.content_block?.type])
    } else if (e.type === 'content_block_delta') {
      assert.ok(
        open.has(e.index),
        `content_block_delta targets unopened index ${e.index}`,
      )
    } else if (e.type === 'content_block_stop') {
      assert.ok(
        open.has(e.index),
        `content_block_stop on unopened index ${e.index}`,
      )
      open.delete(e.index)
    }
  }
  assert.equal(open.size, 0, `unclosed blocks remain: ${[...open.keys()]}`)
  return starts
}

test('content -> reasoning -> content interleave keeps blocks on distinct indices (the bug)', async () => {
  const { blockEvents, assistant } = await run([
    { type: 'content_delta', text: 'Hello ' },
    { type: 'reasoning_delta', text: 'think' },
    { type: 'content_delta', text: 'world' },
    { type: 'finish', finishReason: 'stop' },
  ])
  const starts = assertWellFormed(blockEvents)
  // text(0), thinking(1), text(2) — three blocks, three DISTINCT indices. The
  // old code opened the thinking block at index 0 (colliding with the open text
  // block) and then stranded a text_delta on an index that never started.
  assert.deepEqual(starts, [
    [0, 'text'],
    [1, 'thinking'],
    [2, 'text'],
  ])
  assert.ok(assistant, 'the assembler still yields a final assistant message')
})

test('the interleave loses no content or reasoning', async () => {
  const { assistant } = await run([
    { type: 'content_delta', text: 'Hello ' },
    { type: 'reasoning_delta', text: 'think' },
    { type: 'content_delta', text: 'world' },
    { type: 'finish', finishReason: 'stop' },
  ])
  const blocks = assistant?.message?.content ?? []
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
  const thinking = blocks
    .filter(b => b.type === 'thinking')
    .map(b => b.thinking)
    .join('')
  assert.equal(text, 'Hello world')
  assert.equal(thinking, 'think')
})

test('conformant order (reasoning before content) is well-formed and unchanged', async () => {
  const { blockEvents } = await run([
    { type: 'reasoning_delta', text: 'think' },
    { type: 'content_delta', text: 'world' },
    { type: 'finish', finishReason: 'stop' },
  ])
  // closeTextIfOpen is a no-op when no text block is open, so this path is
  // byte-identical to before the fix: thinking(0) then text(1).
  assert.deepEqual(assertWellFormed(blockEvents), [
    [0, 'thinking'],
    [1, 'text'],
  ])
})

test('multiple reasoning deltas after text close the text block exactly once', async () => {
  const { blockEvents } = await run([
    { type: 'content_delta', text: 'a' },
    { type: 'reasoning_delta', text: 'r1' },
    { type: 'reasoning_delta', text: 'r2' },
    { type: 'content_delta', text: 'b' },
    { type: 'finish', finishReason: 'stop' },
  ])
  const starts = assertWellFormed(blockEvents)
  assert.deepEqual(starts, [
    [0, 'text'],
    [1, 'thinking'],
    [2, 'text'],
  ])
  // exactly one thinking block opened despite two reasoning deltas
  assert.equal(starts.filter(([, t]) => t === 'thinking').length, 1)
})

test('text-only and reasoning-only streams are well-formed', async () => {
  const textOnly = await run([
    { type: 'content_delta', text: 'just text' },
    { type: 'finish', finishReason: 'stop' },
  ])
  assert.deepEqual(assertWellFormed(textOnly.blockEvents), [[0, 'text']])

  const reasoningOnly = await run([
    { type: 'reasoning_delta', text: 'just thinking' },
    { type: 'finish', finishReason: 'stop' },
  ])
  assert.deepEqual(assertWellFormed(reasoningOnly.blockEvents), [[0, 'thinking']])
})
